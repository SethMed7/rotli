const root = document.documentElement;
const colorPicker = document.querySelector("#custom-color");
const hexInput = document.querySelector("#custom-hex");
const colorName = document.querySelector("[data-color-name]");
const colorValue = document.querySelector("[data-color-value]");
const colorButtons = [...document.querySelectorAll("[data-quokka-color]")];

function normalizeHex(value) {
  const candidate = value.trim().replace(/^#?/, "#").toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : null;
}

function setBodyColor(value, label = "Custom") {
  const hex = normalizeHex(value);
  if (!hex) return false;
  root.style.setProperty("--quokka-body", hex);
  colorPicker.value = hex.toLowerCase();
  hexInput.value = hex;
  colorName.textContent = label;
  colorValue.textContent = hex;
  colorButtons.forEach((button) => {
    const active = button.dataset.quokkaColor.toUpperCase() === hex && label !== "Custom";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  return true;
}

colorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setBodyColor(button.dataset.quokkaColor, button.dataset.colorLabel);
  });
});

colorPicker.addEventListener("input", () => setBodyColor(colorPicker.value));

function applyHexInput() {
  if (setBodyColor(hexInput.value)) {
    hexInput.removeAttribute("aria-invalid");
    return;
  }
  hexInput.setAttribute("aria-invalid", "true");
}

hexInput.addEventListener("change", applyHexInput);
hexInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyHexInput();
});

document.querySelector("[data-copy-color]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const previous = button.textContent;
  try {
    await navigator.clipboard.writeText(hexInput.value);
    button.textContent = "Copied";
  } catch {
    hexInput.select();
    button.textContent = "Selected";
  }
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1200);
});

const environmentButtons = [...document.querySelectorAll("[data-env-choice]")];
environmentButtons.forEach((button) => {
  button.addEventListener("click", () => {
    root.dataset.env = button.dataset.envChoice;
    environmentButtons.forEach((choice) => {
      const active = choice === button;
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-pressed", String(active));
    });
  });
});

const accessoryPreview = document.querySelector("[data-accessory-preview]");
const accessoryName = document.querySelector("[data-accessory-name]");
const accessoryNote = document.querySelector("[data-accessory-note]");
const accessoryButtons = [...document.querySelectorAll("[data-accessory]")];

accessoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const accessory = button.dataset.accessory;
    accessoryPreview.src = `assets/quokka-concepts/${accessory}.png`;
    accessoryPreview.alt = `Quokka wearing ${button.dataset.label.toLowerCase()}`;
    accessoryName.textContent = button.dataset.label;
    accessoryNote.textContent = button.dataset.note;
    accessoryButtons.forEach((choice) => {
      const active = choice === button;
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-pressed", String(active));
    });
  });
});

const navLinks = [...document.querySelectorAll(".catalog-nav a")];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach((link) => {
      link.classList.toggle("is-current", link.getAttribute("href") === `#${visible.target.id}`);
    });
  },
  { rootMargin: "-18% 0px -68%", threshold: [0.05, 0.2, 0.5] },
);

sections.forEach((section) => observer.observe(section));
