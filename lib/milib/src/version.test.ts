import { expect, test } from "vitest";
import * as version from "./version";

/*
 * versions for tests
 */
const testVersions = {
  "1.0.1": {
    major: 1,
    minor: 0,
    patch: 1,
    suffix: "",
    original: "1.0.1",
    semver: true,
  },
  "1.11.0": {
    major: 1,
    minor: 11,
    patch: 0,
    suffix: "",
    original: "1.11.0",
    semver: true,
  },
  "2.1": {
    major: 2,
    minor: 1,
    patch: 0,
    suffix: "",
    original: "2.1",
    semver: true,
  },
  "2.1-alpha.2": {
    major: 2,
    minor: 1,
    patch: 0,
    suffix: "alpha.2",
    original: "2.1-alpha.2",
    semver: true,
  },
  "3": {
    major: 3,
    minor: 0,
    patch: 0,
    suffix: "",
    original: "3",
    semver: true,
  },
  "4.abra": {
    major: 4,
    minor: 0,
    patch: 0,
    suffix: "abra",
    original: "4.abra",
    semver: false,
  },
  "4.2.abra": {
    major: 4,
    minor: 2,
    patch: 0,
    suffix: "abra",
    original: "4.2.abra",
    semver: false,
  },
  "4.3.abra.kadabra": {
    major: 4,
    minor: 3,
    patch: 0,
    suffix: "abra.kadabra",
    original: "4.3.abra.kadabra",
    semver: false,
  },
  "4.4.abra-kadabra": {
    major: 4,
    minor: 4,
    patch: 0,
    suffix: "abra-kadabra",
    original: "4.4.abra-kadabra",
    semver: false,
  },
  "5.1.2-custom": {
    major: 5,
    minor: 1,
    patch: 2,
    suffix: "custom",
    original: "5.1.2-custom",
    semver: true,
  },
  "5.1.3-alpha.2": {
    major: 5,
    minor: 1,
    patch: 3,
    suffix: "alpha.2",
    original: "5.1.3-alpha.2",
    semver: true,
  },
  "1.3.5.7": {
    major: 1,
    minor: 3,
    patch: 5,
    suffix: "7",
    original: "1.3.5.7",
    semver: false,
  },
  "1.0.1.2.3.4": {
    major: 1,
    minor: 0,
    patch: 1,
    suffix: "2.3.4",
    original: "1.0.1.2.3.4",
    semver: false,
  },
  "1.0.1.beta": {
    major: 1,
    minor: 0,
    patch: 1,
    suffix: "beta",
    original: "1.0.1.beta",
    semver: false,
  },
  "1.0.1-beta+rev.2": {
    major: 1,
    minor: 0,
    patch: 1,
    suffix: "beta+rev.2",
    original: "1.0.1-beta+rev.2",
    semver: true,
  },
  "12.": {
    major: 12,
    minor: 0,
    patch: 0,
    suffix: "",
    original: "12.",
    semver: true,
  },
  "olala!": {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "olala!",
    original: "olala!",
    semver: false,
  },
  "12-00293188": {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "12-00293188",
    original: "12-00293188",
    semver: false,
  },
  "8-deadbeef": {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "8-deadbeef",
    original: "8-deadbeef",
    semver: false,
  },
  "blocks-vdj-clonotyping-qc-checks": {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "blocks-vdj-clonotyping-qc-checks",
    original: "blocks-vdj-clonotyping-qc-checks",
    semver: false,
  },
} as { [key: string]: version.versionInfo };

const parseTests = Object.keys(testVersions);

parseTests.forEach((versionName) =>
  test(`Parse '${versionName}'`, async () => {
    const v: version.versionInfo = version.parse(versionName);
    expect(v).toEqual(testVersions[versionName]);
  }),
);

const compareTests = [
  {
    name: "same version",
    a: testVersions["1.0.1"],
    b: testVersions["1.0.1"],
    expected: 0,
  },
  {
    name: "greater major",
    a: testVersions["1.0.1"],
    b: testVersions["2.1"],
    expected: -1,
  },
  {
    name: "less major",
    a: testVersions["2.1"],
    b: testVersions["1.0.1"],
    expected: 1,
  },
  {
    name: "greater suffix",
    a: testVersions["1.0.1.2.3.4"],
    b: testVersions["1.0.1.beta"],
    expected: -1,
  },
  {
    name: "suffix + no-suffix",
    a: testVersions["2.1-alpha.2"],
    b: testVersions["2.1"],
    expected: -1,
  },
  {
    name: "semver vs non-semver",
    a: testVersions["1.11.0"],
    b: testVersions["blocks-vdj-clonotyping-qc-checks"],
    expected: 1,
  },
];

compareTests.forEach((_case) =>
  test(`Compare '${_case.name}'`, async () => {
    expect(version.compare(_case.a, _case.b)).toBe(_case.expected);
  }),
);

test("Check list sort", async () => {
  const vListStright = Object.values(testVersions);
  vListStright.sort(version.compare);

  const vListInversed = Object.values(testVersions);
  vListInversed.sort((a, b) => version.compare(b, a));

  for (let i = 0; i * 2 < vListInversed.length; i++) {
    expect(vListStright[i]).toBe(vListInversed[vListInversed.length - 1 - i]);
  }
});
