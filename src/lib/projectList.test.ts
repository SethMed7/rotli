import { expect, test } from "bun:test";

import { nextInSeries, nextListBody, openTaskCount } from "./projectList";

test("open work is any unchecked or in-progress task", () => {
  expect(openTaskCount("# Round\n\n- [x] Done\n- [X] Also done\n")).toBe(0);
  expect(openTaskCount("- [x] Done\n- [ ] Next\n  - [/] Halfway\n1. [ ] Numbered\n")).toBe(3);
  expect(openTaskCount("No tasks here, and `- [ ]` in text is not a task")).toBe(0);
});

test("the next note in a series counts up, keeping the rest of the title", () => {
  expect(nextInSeries("Round Four - Rotli Bugs/Enhancements")).toBe("Round Five - Rotli Bugs/Enhancements");
  expect(nextInSeries("round nine")).toBe("round ten");
  expect(nextInSeries("ROUND ONE")).toBe("ROUND TWO");
  expect(nextInSeries("Sprint 3 backlog")).toBe("Sprint 4 backlog");
  expect(nextInSeries("Week 09")).toBe("Week 10");
  expect(nextInSeries("Bug fixes")).toBe("Bug fixes 2");
  // a word inside another word is not a number
  expect(nextInSeries("Someone's list")).toBe("Someone's list 2");
});

test("a new list note starts with its title, a link back, and one empty task", () => {
  expect(nextListBody("Round Five", "Round Four")).toBe(
    "# Round Five\n\nContinues [[Round Four]].\n\n- [ ] \n",
  );
});
