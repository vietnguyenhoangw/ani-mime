import { render, screen, fireEvent } from "@testing-library/react";
import { SpeechBubble } from "../../components/SpeechBubble";

describe("SpeechBubble", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <SpeechBubble visible={false} message="Hello" onDismiss={() => {}} />
    );
    expect(container.querySelector(".speech-bubble")).toBeNull();
  });

  it("shows message when visible=true", () => {
    render(
      <SpeechBubble visible={true} message="Task complete!" onDismiss={() => {}} />
    );
    expect(screen.getByText("Task complete!")).toBeInTheDocument();
  });

  it("renders speech-bubble element when visible", () => {
    const { container } = render(
      <SpeechBubble visible={true} message="Hello" onDismiss={() => {}} />
    );
    expect(container.querySelector(".speech-bubble")).toBeInTheDocument();
  });

  it("renders tail element", () => {
    const { container } = render(
      <SpeechBubble visible={true} message="Hello" onDismiss={() => {}} />
    );
    expect(container.querySelector(".speech-bubble-tail")).toBeInTheDocument();
  });

  it("calls onDismiss on click", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <SpeechBubble visible={true} message="Hello" onDismiss={onDismiss} />
    );

    fireEvent.click(container.querySelector(".speech-bubble")!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
