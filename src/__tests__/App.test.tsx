import { render, screen } from "@testing-library/react";
import App from "../App";
import type { Status } from "../types/status";

// Mock hooks to control behavior in integration tests
const mockUseStatus = vi.fn((): { status: Status; scenario: boolean } => ({ status: "initializing", scenario: false }));
vi.mock("../hooks/useStatus", () => ({
  useStatus: () => mockUseStatus(),
}));

vi.mock("../hooks/useDrag", () => ({
  useDrag: () => ({ dragging: false, onMouseDown: vi.fn() }),
}));

const mockUseBubble = vi.fn(() => ({
  visible: false,
  message: "",
  dismiss: vi.fn(),
  enabled: true,
  setEnabled: vi.fn(),
}));
vi.mock("../hooks/useBubble", () => ({
  useBubble: () => mockUseBubble(),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), loaded: true }),
}));

const mockUseVisitors = vi.fn(() => [] as Array<{ pet: string; nickname: string; duration_secs: number }>);
vi.mock("../hooks/useVisitors", () => ({
  useVisitors: () => mockUseVisitors(),
}));

vi.mock("../hooks/usePeers", () => ({
  usePeers: () => [],
}));

vi.mock("../hooks/useNickname", () => ({
  useNickname: () => ({ nickname: "TestDog", setNickname: vi.fn(), loaded: true }),
}));

vi.mock("../hooks/usePet", () => ({
  usePet: () => ({ pet: "rottweiler", setPet: vi.fn(), loaded: true }),
}));

vi.mock("../hooks/useScale", () => ({
  useScale: () => ({ scale: 1, setScale: vi.fn(), SCALE_PRESETS: [0.5, 1, 1.5, 2] }),
}));

vi.mock("../hooks/useDevMode", () => ({
  useDevMode: () => false,
}));

vi.mock("../hooks/useGlow", () => ({
  useGlow: () => ({ mode: "off", setMode: vi.fn() }),
}));

vi.mock("../hooks/useCustomMimes", () => ({
  useCustomMimes: () => ({
    mimes: [],
    loaded: true,
    pickSpriteFile: vi.fn(),
    addMime: vi.fn(),
    addMimeFromBlobs: vi.fn(),
    deleteMime: vi.fn(),
    getSpriteUrl: vi.fn(),
  }),
}));

describe("App", () => {
  beforeEach(() => {
    mockUseStatus.mockReturnValue({ status: "initializing", scenario: false });
    mockUseBubble.mockReturnValue({
      visible: false,
      message: "",
      dismiss: vi.fn(),
      enabled: true,
      setEnabled: vi.fn(),
    });
    mockUseVisitors.mockReturnValue([]);
  });

  it("renders Mascot and StatusPill in default state", () => {
    const { container } = render(<App />);

    // Mascot renders a .sprite div
    expect(container.querySelector(".sprite")).toBeInTheDocument();
    // StatusPill renders a .pill div
    expect(container.querySelector(".pill")).toBeInTheDocument();
    // Default status label
    expect(screen.getByText("Initializing...")).toBeInTheDocument();
  });

  it("shows SpeechBubble when bubble is visible", () => {
    mockUseBubble.mockReturnValue({
      visible: true,
      message: "Hello there!",
      dismiss: vi.fn(),
      enabled: true,
      setEnabled: vi.fn(),
    });

    render(<App />);
    expect(screen.getByText("Hello there!")).toBeInTheDocument();
  });

  it("hides SpeechBubble when bubble is not visible", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".speech-bubble")).toBeNull();
  });

  it("shows scenario badge when scenario is active", () => {
    mockUseStatus.mockReturnValue({ status: "busy", scenario: true });

    render(<App />);
    expect(screen.getByText("SCENARIO")).toBeInTheDocument();
  });

  it("does not show scenario badge when scenario is inactive", () => {
    mockUseStatus.mockReturnValue({ status: "busy", scenario: false });

    render(<App />);
    expect(screen.queryByText("SCENARIO")).toBeNull();
  });

  it("applies scenario-active class when scenario is active", () => {
    mockUseStatus.mockReturnValue({ status: "busy", scenario: true });

    const { container } = render(<App />);
    expect(container.querySelector(".container")).toHaveClass("scenario-active");
  });

  it("renders VisitorDog components for each visitor", () => {
    mockUseVisitors.mockReturnValue([
      { pet: "dalmatian", nickname: "Buddy", duration_secs: 30 },
      { pet: "rottweiler", nickname: "Rex", duration_secs: 60 },
    ]);

    render(<App />);
    expect(screen.getByText("Buddy")).toBeInTheDocument();
    expect(screen.getByText("Rex")).toBeInTheDocument();
  });

  it("hides Mascot sprite and shows placeholder when visiting", () => {
    mockUseStatus.mockReturnValue({ status: "visiting", scenario: false });

    const { container } = render(<App />);
    // When visiting, Mascot is not rendered, only a placeholder div
    expect(container.querySelector(".sprite")).toBeNull();
  });

  it("shows StatusPill with visiting label when visiting", () => {
    mockUseStatus.mockReturnValue({ status: "visiting", scenario: false });

    render(<App />);
    expect(screen.getByText("Visiting...")).toBeInTheDocument();
  });
});
