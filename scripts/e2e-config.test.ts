import { expect, test } from "bun:test";

function config(file: string, ports: { desktop?: string; web?: string } = {}) {
  const url = new URL(`../${file}`, import.meta.url).href;
  const result = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `const {default:c} = await import(${JSON.stringify(url)}); console.log(JSON.stringify({baseURL:c.use.baseURL,webServer:c.webServer}));`,
    ],
    {
      env: { ...process.env, ROTLI_E2E_PORT: ports.desktop ?? "", ROTLI_WEB_E2E_PORT: ports.web ?? "" },
    },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString()) as {
    baseURL: string;
    webServer: { command: string; url: string; reuseExistingServer: boolean };
  };
}

test("Web tests can use an isolated port for both browser and server", () => {
  const web = config("playwright.web.config.ts", { desktop: "1462", web: "1463" });
  expect(web.baseURL).toBe("http://localhost:1463");
  expect(web.webServer.url).toBe("http://localhost:1463/app/");
  expect(web.webServer.command).toContain("--port 1463 --strictPort");
});

test.each(["playwright.config.ts", "playwright.web.config.ts"])(
  "%s refuses to reuse another checkout's server",
  (file) => {
    expect(config(file).webServer.reuseExistingServer).toBe(false);
  },
);

test("the two lanes retain their defaults and independent overrides", () => {
  expect(config("playwright.config.ts").baseURL).toBe("http://localhost:1420");
  expect(config("playwright.web.config.ts").baseURL).toBe("http://localhost:1435");
  const desktop = config("playwright.config.ts", { desktop: "1462", web: "1463" });
  expect(desktop.baseURL).toBe("http://localhost:1462");
  expect(desktop.webServer.url).toBe("http://localhost:1462");
  expect(desktop.webServer.command).toContain("--port 1462 --strictPort");
}, 15_000);
