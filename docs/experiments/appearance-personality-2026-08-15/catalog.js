const root = document.documentElement;

function choose(attribute, value, selector) {
  root.dataset[attribute] = value;
  document.querySelectorAll(selector).forEach((button) => {
    const isActive = button.dataset[`${attribute}Choice`] === value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

document.querySelectorAll("[data-env-choice]").forEach((button) => {
  button.addEventListener("click", () => choose("env", button.dataset.envChoice, "[data-env-choice]"));
});

document.querySelectorAll("[data-accent-choice]").forEach((button) => {
  button.addEventListener("click", () =>
    choose("accent", button.dataset.accentChoice, "[data-accent-choice]"),
  );
});

document.querySelectorAll("[data-selection-choice]").forEach((button) => {
  button.addEventListener("click", () =>
    choose("selection", button.dataset.selectionChoice, "[data-selection-choice]"),
  );
});

document.querySelectorAll("[data-env-card]").forEach((button) => {
  button.addEventListener("click", () => {
    const environment = button.dataset.envCard;
    choose("env", environment, "[data-env-choice]");
    document.querySelectorAll("[data-env-card]").forEach((card) => {
      card.classList.toggle("is-selected", card === button);
    });
  });
});

const navLinks = [...document.querySelectorAll(".lab-nav a")].filter((link) =>
  link.getAttribute("href").startsWith("#"),
);
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
  { rootMargin: "-20% 0px -65%", threshold: [0.05, 0.25, 0.5] },
);

sections.forEach((section) => observer.observe(section));
