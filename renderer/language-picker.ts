import { filterLanguages, type LanguageModel } from "./language-catalog.js";

export class LanguagePicker {
  private readonly button: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private models: LanguageModel[] = [];
  private selected = "";
  private onSelection?: (value: string) => void;

  constructor(private readonly root: HTMLElement, label: string) {
    root.innerHTML = `
      <button class="language-picker-button" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span>Loading languages…</span><span aria-hidden="true">⌄</span>
      </button>
      <div class="language-picker-popover hidden">
        <input class="language-search" type="search" autocomplete="off" placeholder="Search languages" aria-label="Search ${label}" />
        <div class="language-options" role="listbox" aria-label="${label}"></div>
        <p class="language-picker-status" role="status"></p>
      </div>`;
    this.button = root.querySelector("button")!;
    this.popover = root.querySelector(".language-picker-popover")!;
    this.search = root.querySelector("input")!;
    this.list = root.querySelector(".language-options")!;
    this.status = root.querySelector(".language-picker-status")!;
    this.button.addEventListener("click", () => this.toggle());
    this.search.addEventListener("input", () => this.render());
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    document.addEventListener("pointerdown", (event) => {
      if (!this.root.contains(event.target as Node)) this.close();
    });
  }

  get value(): string { return this.selected; }

  setOptions(models: LanguageModel[], selected?: string): void {
    this.models = models;
    this.selected = selected && models.some((model) => model.value === selected)
      ? selected
      : models[0]?.value ?? "";
    this.search.value = "";
    this.render();
    this.renderButton();
  }

  select(value: string): void {
    if (!this.models.some((model) => model.value === value)) return;
    this.selected = value;
    this.render();
    this.renderButton();
  }

  onChange(listener: (value: string) => void): void { this.onSelection = listener; }

  setDisabled(disabled: boolean): void {
    this.button.disabled = disabled;
    this.search.disabled = disabled;
    if (disabled) this.close();
  }

  setMessage(message: string): void {
    this.models = [];
    this.selected = "";
    this.button.querySelector("span")!.textContent = message;
    this.button.disabled = true;
    this.status.textContent = message;
    this.list.replaceChildren();
  }

  private render(): void {
    const visible = filterLanguages(this.models, this.search.value);
    this.list.replaceChildren(...visible.map((model) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "language-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(model.value === this.selected));
      option.dataset.value = model.value;
      option.innerHTML = `<span><strong></strong><small></small></span><span class="language-check" aria-hidden="true">✓</span>`;
      option.querySelector("strong")!.textContent = model.name;
      option.querySelector("small")!.textContent = model.nativeName === model.name ? model.value : `${model.nativeName} · ${model.value}`;
      option.addEventListener("click", () => {
        const changed = this.selected !== model.value;
        this.selected = model.value;
        this.renderButton();
        this.close();
        if (changed) this.onSelection?.(model.value);
      });
      return option;
    }));
    this.status.textContent = visible.length ? `${visible.length} language${visible.length === 1 ? "" : "s"}` : "No languages match your search.";
  }

  private renderButton(): void {
    const model = this.models.find((candidate) => candidate.value === this.selected);
    this.button.querySelector("span")!.textContent = model?.name ?? "Choose a language";
    this.button.disabled = !model;
  }

  private toggle(): void {
    const opening = this.popover.classList.contains("hidden");
    if (opening) {
      this.popover.classList.remove("hidden");
      this.button.setAttribute("aria-expanded", "true");
      this.search.focus();
    } else this.close();
  }

  private close(): void {
    this.popover.classList.add("hidden");
    this.button.setAttribute("aria-expanded", "false");
  }

  private keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.close();
      this.button.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || this.popover.classList.contains("hidden")) return;
    event.preventDefault();
    const options = [...this.list.querySelectorAll<HTMLButtonElement>(".language-option")];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    options[(index + delta + options.length) % options.length]?.focus();
  }
}
