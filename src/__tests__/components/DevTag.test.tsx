import { render, screen, fireEvent } from "@testing-library/react";
import { DevTag } from "../../components/DevTag";
import { invoke } from "@tauri-apps/api/core";
import { mockInvoke } from "../../__mocks__/tauri";

describe("DevTag", () => {
  beforeEach(() => {
    mockInvoke("open_superpower", undefined);
  });

  it("renders DEV text", () => {
    render(<DevTag />);
    expect(screen.getByText("DEV")).toBeInTheDocument();
  });

  it("renders as a button", () => {
    render(<DevTag />);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("dev-tag");
  });

  it("invokes open_superpower on click", async () => {
    render(<DevTag />);

    fireEvent.click(screen.getByText("DEV"));

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_superpower");
    });
  });
});
