import { expect, test } from "vitest";
import { countOccurrences } from "./string";

/*
 * countOccurrences tests
 */
const countOccurrencesTests = [
  {
    testName: "count occurrences in empty string",
    str: "",
    substr: "a",
    expect: 0,
  },
  {
    testName: "count occurrences of empty target",
    str: "",
    substr: "a",
    expect: 0,
  },
  {
    testName: "no occurrences",
    str: "some random string with no newline symbols inside",
    substr: "\n",
    expect: 0,
  },
  {
    testName: "has occurrences at the start",
    str: "a string begins with the only corresponding symbol",
    substr: "a",
    expect: 1,
  },
  {
    testName: "has occurrences at the end",
    str: "the string that matches only at the end!",
    substr: "d!",
    expect: 1,
  },
  {
    testName: "has occurrences in the middle",
    str: "two lines of text\nwith only one newline symbol between",
    substr: "\n",
    expect: 1,
  },
  {
    testName: "all occurrences found",
    str: "simple text with four paces",
    substr: " ",
    expect: 4,
  },
  {
    testName: "long pattern caught once",
    str: "aaaaaa",
    substr: "aaaa",
    expect: 1,
  },
];

countOccurrencesTests.forEach((value) => {
  test(value.testName, async () => {
    const cnt: number = countOccurrences(value.str, value.substr);
    expect(cnt).toBe(value.expect);
  });
});
