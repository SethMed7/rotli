// Figures in posts (src/figures.ts, drawn at build time from a ```figure fence): each chart is an
// SVG named by its visible title and described by its values, with its numbers as a table and a
// caption that cites the source; each diagram is an ordered list of steps. No inline style, no
// colour attribute, and nothing wider than the column on a phone.
import { expect, test } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";

test("each chart has an accessible name, a description, a cited caption, and its table", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const charts = page.locator('figure[data-figure="bar"]');
  await expect(charts).toHaveCount(3);

  const thirty = page.getByRole("img", { name: "Paying users who hadn't used the tool in the past 30 days" });
  await expect(thirty).toBeVisible();
  const description = await thirty.evaluate((svg) => {
    const id = svg.getAttribute("aria-describedby")!;
    return document.getElementById(id)!.textContent;
  });
  expect(description).toBe(
    "Hadn't used it in the past 30 days: ChatGPT 50.4%, Midjourney 42.6%, Canva AI 40.2%, Gemini 35.3%, Claude 27.2%.",
  );
  // The bars are as long as their values on a 0 to 100 scale.
  const widths = await thirty
    .locator(".chart-bar")
    .evaluateAll((bars) => bars.map((bar) => bar.getAttribute("width")));
  expect(widths).toEqual(["50.4%", "42.6%", "40.2%", "35.3%", "27.2%"]);

  const first = charts.first();
  await expect(first.locator("figcaption")).toContainText("1,272 U.S. adults");
  await expect(first.locator("figcaption a")).toHaveAttribute(
    "href",
    "https://www.self.inc/info/cost-of-unused-paid-subscriptions/",
  );
  // The table: closed until asked for, then every row.
  const table = first.getByRole("table");
  await expect(table).toBeHidden();
  await first.getByText("The numbers as a table").click();
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(6);
  await expect(table.getByRole("row", { name: "ChatGPT 50.4%" })).toBeVisible();

  const daily = page.getByRole("img", { name: "People who use AI daily, by whether they pay for it" });
  await expect(daily).toBeVisible();
  await expect(charts.nth(1).locator("figcaption")).toContainText("5,067 U.S. adults");
  await expect(charts.nth(1).getByRole("table", { includeHidden: true }).locator("td")).toHaveText([
    "50%",
    "26%",
  ]);
});

test("the Librarian diagram reads as an ordered list of steps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const flow = page.getByRole("list", { name: "How the Librarian puts an idle plan to work" });
  await expect(flow).toBeVisible();
  await expect(flow.locator(":scope > li > b")).toHaveText(["Your note", "The Librarian", "Frontmatter"]);
  await expect(flow.getByRole("list", { name: "Either of these" }).locator("b")).toHaveText([
    "Your AI plan",
    "A model on your Mac",
  ]);
  // Steps run left to right on a wide column, top to bottom on a phone.
  const steps = flow.locator(":scope > li");
  const [a, b] = [(await steps.nth(0).boundingBox())!, (await steps.nth(1).boundingBox())!];
  expect(b.x).toBeGreaterThan(a.x + a.width);
  await page.setViewportSize({ width: 390, height: 844 });
  const [c, d] = [(await steps.nth(0).boundingBox())!, (await steps.nth(1).boundingBox())!];
  expect(d.y).toBeGreaterThan(c.y + c.height);
});

for (const path of [POST, "/blog/rotli-web-and-your-mac/"]) {
  test(`${path}: figures carry no inline style and fit a phone's column`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const figures = page.locator("figure.figure");
    expect(await figures.count()).toBeGreaterThan(0);
    expect(
      await page.locator("figure.figure [style], figure.figure [fill], figure.figure [stroke]").count(),
    ).toBe(0);
    const prose = (await page.locator("[data-prose]").boundingBox())!;
    for (const figure of await figures.all()) {
      await figure.scrollIntoViewIfNeeded();
      const box = (await figure.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(prose.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(prose.x + prose.width + 1);
      // Every value's label is fully inside the figure.
      for (const value of await figure.locator(".chart-value").all()) {
        const label = (await value.boundingBox())!;
        expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width + 1);
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
}
