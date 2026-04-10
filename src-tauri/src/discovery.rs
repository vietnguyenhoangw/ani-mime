use std::sync::{Arc, Mutex};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use tauri::Emitter;

use crate::helpers::get_port;
use crate::state::{AppState, PeerInfo};

const SERVICE_TYPE: &str = "_ani-mime._tcp.local.";

/// Detect the machine's primary LAN IP by attempting a UDP connect to a public address.
/// No actual traffic is sent — the OS just picks the best source interface.
fn detect_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// From a set of addresses, prefer IPv4 over IPv6, and non-loopback over loopback.
fn pick_best_addr(addrs: &[String]) -> Option<String> {
    // Prefer non-loopback IPv4
    if let Some(a) = addrs.iter().find(|a| !a.contains(':') && *a != "127.0.0.1") {
        return Some(a.clone());
    }
    // Fallback to any IPv4
    if let Some(a) = addrs.iter().find(|a| !a.contains(':')) {
        return Some(a.clone());
    }
    // Fallback to any non-loopback IPv6
    if let Some(a) = addrs.iter().find(|a| *a != "::1") {
        return Some(a.clone());
    }
    addrs.first().cloned()
}

/// Register this instance on the network and browse for peers.
pub fn start_discovery(
    app_handle: tauri::AppHandle,
    app_state: Arc<Mutex<AppState>>,
    nickname: String,
    pet: String,
) {
    std::thread::spawn(move || {
        crate::app_log!("[discovery] starting mDNS discovery (nickname={}, pet={})", nickname, pet);

        // Log the detected local IP for diagnostics
        match detect_local_ip() {
            Some(ip) => crate::app_log!("[discovery] detected local IP: {}", ip),
            None => crate::app_warn!("[discovery] could not detect local IP (no default route?)"),
        }

        let port = get_port();
        crate::app_log!("[discovery] using port {}", port);

        let mdns = match ServiceDaemon::new() {
            Ok(d) => {
                crate::app_log!("[discovery] mDNS daemon created");
                d
            }
            Err(e) => {
                crate::app_error!("[discovery] failed to create mDNS daemon: {}", e);
                return;
            }
        };

        // Resolve hostname
        let raw_host = hostname::get()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let host_name = if raw_host.ends_with(".local") || raw_host.ends_with(".local.") {
            if raw_host.ends_with('.') { raw_host.clone() } else { format!("{}.", raw_host) }
        } else {
            format!("{}.local.", raw_host.trim_end_matches('.'))
        };
        crate::app_log!("[discovery] hostname: {} -> {}", raw_host, host_name);

        let instance_name = format!("{}-{}", nickname, std::process::id());

        let properties = [
            ("nickname", nickname.as_str()),
            ("pet", pet.as_str()),
        ];

        // Detect the primary LAN IPv4 address explicitly.
        // enable_addr_auto() only finds interfaces with IPv6 link-local addresses,
        // which misses en0 (WiFi) when it has IPv4-only. We pass the detected IP
        // directly and ALSO enable auto so both IPv4 and IPv6 peers can find us.
        let explicit_ip = detect_local_ip().unwrap_or_default();
        if explicit_ip.is_empty() {
            crate::app_warn!("[discovery] no explicit IP detected, relying on addr_auto only");
        } else {
            crate::app_log!("[discovery] will register with explicit IP: {}", explicit_ip);
        }

        let service_info = match ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            explicit_ip.as_str(),
            port,
            &properties[..],
        ) {
            Ok(info) => info.enable_addr_auto(),
            Err(e) => {
                crate::app_error!("[discovery] failed to create ServiceInfo: {}", e);
                return;
            }
        };

        // Log all addresses (explicit + auto-detected)
        let registered_addrs: Vec<String> = service_info.get_addresses()
            .iter()
            .map(|a| a.to_string())
            .collect();
        crate::app_log!(
            "[discovery] service addresses: [{}] (explicit={}, auto=true)",
            registered_addrs.join(", "), explicit_ip
        );

        match mdns.register(service_info.clone()) {
            Ok(_) => crate::app_log!("[discovery] registered as {} on {} (port={})", instance_name, host_name, port),
            Err(e) => {
                crate::app_error!("[discovery] failed to register mDNS service: {}", e);
                return;
            }
        }

        // Store discovery info in AppState for debug endpoint access
        {
            let mut st = app_state.lock().unwrap();
            st.discovery_instance = instance_name.clone();
            st.discovery_addrs = registered_addrs;
            st.discovery_port = port;
        }

        // Browse for peers
        let receiver = match mdns.browse(SERVICE_TYPE) {
            Ok(r) => {
                crate::app_log!("[discovery] browsing for {} peers", SERVICE_TYPE);
                r
            }
            Err(e) => {
                crate::app_error!("[discovery] failed to start mDNS browse: {}", e);
                return;
            }
        };

        // Periodic heartbeat thread — logs discovery status every 30s
        // Also emits a one-shot "discovery-hint" event if no peers found after first check
        let heartbeat_state = app_state.clone();
        let heartbeat_handle = app_handle.clone();
        std::thread::spawn(move || {
            let mut hint_emitted = false;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let st = heartbeat_state.lock().unwrap();
                let peer_names: Vec<String> = st.peers.values()
                    .map(|p| format!("{}({}:{})", p.nickname, p.ip, p.port))
                    .collect();
                let peer_count = peer_names.len();
                if peer_names.is_empty() {
                    crate::app_log!("[discovery] heartbeat: 0 peers found, still listening on port {}", st.discovery_port);
                } else {
                    crate::app_log!("[discovery] heartbeat: {} peers: [{}]", peer_names.len(), peer_names.join(", "));
                }
                drop(st);

                // One-shot hint: if still no peers after 30s, nudge the user
                if !hint_emitted && peer_count == 0 {
                    hint_emitted = true;
                    crate::app_log!("[discovery] no peers after 30s, emitting discovery-hint");
                    let _ = heartbeat_handle.emit("discovery-hint", "no_peers");
                }
            }
        });

        let my_instance = instance_name.clone();

        loop {
            match receiver.recv() {
                Ok(event) => match event {
                    ServiceEvent::SearchStarted(stype) => {
                        crate::app_log!("[discovery] search started for {}", stype);
                    }
                    ServiceEvent::ServiceFound(stype, fullname) => {
                        crate::app_log!("[discovery] service found: {} (type={})", fullname, stype);
                    }
                    ServiceEvent::ServiceResolved(info) => {
                        let peer_instance = info.get_fullname().to_string();

                        // Skip ourselves — match on "{instance_name}." prefix
                        if peer_instance.starts_with(&format!("{}.", my_instance)) {
                            crate::app_log!("[discovery] resolved self, skipping: {}", peer_instance);
                            continue;
                        }

                        let nickname = info.get_property_val_str("nickname")
                            .unwrap_or("Unknown")
                            .to_string();
                        let pet = info.get_property_val_str("pet")
                            .unwrap_or("rottweiler")
                            .to_string();
                        let addrs: Vec<String> = info.get_addresses().iter()
                            .map(|a| a.to_string())
                            .collect();
                        let port = info.get_port();

                        crate::app_log!(
                            "[discovery] peer resolved: {} (nickname={}, pet={}, all_addrs=[{}], port={})",
                            peer_instance, nickname, pet, addrs.join(", "), port
                        );

                        // Prefer IPv4 non-loopback address
                        let ip = match pick_best_addr(&addrs) {
                            Some(best) => {
                                crate::app_log!("[discovery] selected address for {}: {}", nickname, best);
                                best
                            }
                            None => {
                                crate::app_warn!("[discovery] peer {} has no usable address, skipping (addrs=[{}])", peer_instance, addrs.join(", "));
                                continue;
                            }
                        };

                        let peer = PeerInfo {
                            instance_name: peer_instance.clone(),
                            nickname,
                            pet,
                            ip,
                            port,
                        };

                        let mut st = app_state.lock().unwrap();
                        st.peers.insert(peer_instance, peer);
                        let peer_count = st.peers.len();
                        let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
                        drop(st);

                        crate::app_log!("[discovery] total peers: {}", peer_count);

                        if let Err(e) = app_handle.emit("peers-changed", &peers) {
                            crate::app_error!("[discovery] failed to emit peers-changed: {}", e);
                        }
                    }
                    ServiceEvent::ServiceRemoved(stype, fullname) => {
                        crate::app_log!("[discovery] peer removed: {} (type={})", fullname, stype);

                        let mut st = app_state.lock().unwrap();
                        st.peers.remove(&fullname);
                        let peer_count = st.peers.len();
                        let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
                        drop(st);

                        crate::app_log!("[discovery] total peers after removal: {}", peer_count);

                        if let Err(e) = app_handle.emit("peers-changed", &peers) {
                            crate::app_error!("[discovery] failed to emit peers-changed: {}", e);
                        }
                    }
                    ServiceEvent::SearchStopped(stype) => {
                        crate::app_warn!("[discovery] search stopped for {}", stype);
                    }
                    other => {
                        crate::app_log!("[discovery] unhandled event: {:?}", other);
                    }
                },
                Err(e) => {
                    crate::app_error!("[discovery] mDNS receiver error: {}", e);
                    break;
                }
            }
        }

        crate::app_warn!("[discovery] mDNS event loop exited");
    });
}
