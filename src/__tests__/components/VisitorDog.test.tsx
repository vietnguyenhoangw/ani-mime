import { render, screen, act } from "@testing-library/react";
import { VisitorDog } from "../../components/VisitorDog";

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
}));

// Mock useScale to return default scale
vi.mock("../../hooks/useScale", () => ({
  useScale: () => ({ scale: 1, setScale: vi.fn(), SCALE_PRESETS: [0.5, 1, 1.5, 2] }),
}));

describe("VisitorDog", () => {
  it("renders pet sprite and nickname", () => {
    render(<VisitorDog pet="dalmatian" nickname="Buddy" index={0} />);
    expect(screen.getByText("Buddy")).toBeInTheDocument();
  });

  it("renders visitor-sprite with background image", () => {
    const { container } = render(
      <VisitorDog pet="rottweiler" nickname="Rex" index={0} />
    );
    const sprite = container.querySelector(".visitor-sprite") as HTMLElement;
    expect(sprite).toBeInTheDocument();
    expect(sprite.style.backgroundImage).toContain("url(");
  });

  it("positions based on index using CSS custom property", () => {
    const { container } = render(
      <VisitorDog pet="dalmatian" nickname="Buddy" index={2} />
    );
    const dog = container.querySelector(".visitor-dog") as HTMLElement;
    // index=2, scale=1: offset = 2 * 80 * 1 = 160
    expect(dog.style.getPropertyValue("--visitor-offset")).toBe("160px");
  });

  it("applies entered class after mount (via requestAnimationFrame)", async () => {
    const { container } = render(
      <VisitorDog pet="dalmatian" nickname="Buddy" index={0} />
    );

    // Flush the requestAnimationFrame callback within act() so the
    // setEntered(true) state update doesn't fire outside of act()
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    const dog = container.querySelector(".visitor-dog");
    expect(dog).toHaveClass("entered");
  });

  it("uses idle sprite for visitors", () => {
    const { container } = render(
      <VisitorDog pet="dalmatian" nickname="Buddy" index={0} />
    );
    const sprite = container.querySelector(".visitor-sprite") as HTMLElement;
    // DalmatianSitting.png is the idle sprite for dalmatian
    expect(sprite.style.backgroundImage).toContain("DalmatianSitting");
  });

  it("sets sprite size to 96px at scale 1", () => {
    const { container } = render(
      <VisitorDog pet="dalmatian" nickname="Buddy" index={0} />
    );
    const sprite = container.querySelector(".visitor-sprite") as HTMLElement;
    expect(sprite.style.width).toBe("96px");
    expect(sprite.style.height).toBe("96px");
  });
});
