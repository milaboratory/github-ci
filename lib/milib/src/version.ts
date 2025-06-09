import * as semver from 'semver'

// /**
//  * Check if version string contains only dots, hyphens and numbers:
//  *  - 1.2.3    -> true
//  *  - 1.0.4-1  -> true
//  *  - 3.9.4a   -> false (a is letter)
//  */
// export function isNumeric(v: string): boolean {
//   const n = Number(v.replaceAll(/[-.]/g, ""));
//   return !Number.isNaN(n);
// }

function isNumber(v: string): boolean {
  const n = Number(v);
  return !Number.isNaN(n);
}

// <major>.<minor>.<patch>[-<suffix> | .<suffix>]
export interface versionInfo {
  major: number;
  minor: number;
  patch: number;
  suffix: string;
  original: string;
  semver: boolean;
}

export function parse(v: string): versionInfo {
  const result = {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "", // part of the version string left after main fields parsing
    original: v, // original version string parsed by parser
    semver: false, // the version seems to conform with semver
  } as versionInfo;

  const sv = semver.parse(v)
  if (sv) {
    result.major = sv.major
    result.minor = sv.minor
    result.patch = sv.patch
    result.semver = true

    if (sv.prerelease.length > 0) {
      result.suffix += sv.prerelease.join(".")
    }

    if (sv.build.length > 0) {
      const p = sv.build.map((v: string | number) => v.toString())
      result.suffix += "+" + sv.build.join(".")
    }

    return result
  }

  const parts = v.split(".");

  if (isNumber(parts[0])) {
    result.major = Number(parts[0]);
  } else {
    result.suffix = v;
  }

  if (parts.length === 1) {
    // Only <major> version part or completely unknown version format
    result.semver = isNumber(parts[0]);
    return result;
  }

  // parts.length >= 2
  if (!isNumber(parts[1])) {
    // Cases:
    //  - 3.alpha (unknown format)
    //  - 3.2-alpha (incomplete semver)
    const minor = parse_suffix(parts[1]);

    if (Number.isNaN(minor.v)) {
      // Unknown format.
      result.suffix = parts.slice(1).join(".");
      return result;
    }

    // Incomplete semver format with suffix
    result.minor = minor.v;
    result.suffix = [minor.s].concat(parts.slice(2)).join(".");
    result.semver = true;
    return result;
  }

  result.minor = Number(parts[1]);
  if (parts.length === 2) {
    // Incomplete semver format: <major>.<minor>
    result.semver = true;
    return result;
  }

  // parts.length >=3
  if (isNumber(parts[2])) {
    // Regular semver with numeric <patch> part: <major>.<minor>.<patch>
    result.patch = Number(parts[2]);
    result.semver = parts.length === 3;

    if (parts.length > 3) {
      // Custom case with additional version parts: <major>.<minor>.<patch>.<...>
      // Put rest of dots into 'suffix' field: <major>.<minor>.<patch>.<suffix>
      result.suffix = parts.slice(3).join(".");
    }
    return result;
  }

  // parts.length >= 3 and parts[2] is not a number:
  // Cases:
  //   - 2.2.abra
  //   - 2.2.abra.kadabra
  //   - 2.2.abra-kadabra
  //   - 0.2.3-custom
  //   - 1.2.3-alpha.2

  const patch = parse_suffix(parts[2]);
  if (Number.isNaN(patch.v)) {
    // <patch> version parts has no '-' delimiters and not a number.
    // Treat non-numeric <patch> version as suffix: <major>.<minor>.<suffix>
    // Cases:
    //   - 2.2.abrakadabra
    //   - 2.2.abra.kadabra
    result.suffix = parts.slice(2).join(".");
    return result;
  }

  // Canonical semver case with suffix: <major>.<minor>.<patch>-<suffix>
  // Cases:
  //   - 0.2.3-custom
  //   - 1.2.3-alpha.2
  result.patch = patch.v;
  result.suffix = [patch.s].concat(parts.slice(3)).join(".");
  result.semver = true;
  return result;
}

interface parseSuffixResult {
  v: number;
  s: string;
}

function parse_suffix(value: string): parseSuffixResult {
  const parts = value.split("-");

  if (parts.length === 1) {
    // Cases:
    //   - abc
    //   - 123
    //   - ''
    if (isNumber(value)) {
      return {
        v: Number(value),
        s: "",
      };
    }

    // value has no '-' delimiters and not a number
    // Cases:
    //   - abc
    //   - ''
    return {
      v: NaN,
      s: value,
    };
  }

  if (!isNumber(parts[0])) {
    // Cases:
    //   - abc-def
    return {
      v: NaN,
      s: value,
    };
  }

  // Cases:
  //   - 1-abc
  //   - 1-abc-def
  return {
    v: Number(parts[0]),
    s: parts.slice(1).join("-"),
  };
}

/**
 * Compares <a> and <b> versions
 *   - returns -1 if <a> < <b>
 *   - returns  1 if <a> > <b>
 *   - returns  0 if <a> == <b>
 */
export function compare(a: versionInfo, b: versionInfo, trySanitize?: boolean): number {
  if (trySanitize === undefined) {
    trySanitize = true
  }

  if (trySanitize) {
    a = sanitize(a)
    b = sanitize(b)
  }

  if (a.semver && !b.semver) {
    // Always prefer semver versions to non-semver
    return 1
  }
  if (b.semver && !a.semver) {
    // Always prefer semver versions to non-semver
    return -1
  }
  if (!a.semver && !b.semver) {
    // Compare unknown version formats as stings
    if (a.original < b.original) {
      return -1;
    }
    if (a.original > b.original) {
      return 1;
    }

    return 0;
  }

  // Both versions are semver

  if (a.major < b.major) {
    return -1;
  }
  if (a.major > b.major) {
    return 1;
  }

  if (a.minor < b.minor) {
    return -1;
  }
  if (a.minor > b.minor) {
    return 1;
  }

  if (a.patch < b.patch) {
    return -1;
  }
  if (a.patch > b.patch) {
    return 1;
  }

  // <major>, <minor> and <patch> versions are the same for both <a> and <b> here

  if (b.suffix === "" && a.suffix !== "") {
    // Consider versions with suffix (alpha, beta, etc.) to be smaller than final versions
    return -1;
  }
  if (a.suffix === "" && b.suffix !== "") {
    // Consider versions with suffix (alpha, beta, etc.) to be smaller than final versions
    return 1;
  }
  if (a.suffix < b.suffix) {
    return -1;
  }
  if (a.suffix > b.suffix) {
    return 1;
  }

  return 0;
}

export function toString(v: versionInfo): string {
  if (!v.semver) {
    return v.original;
  }

  if (v.suffix === "") {
    return `${v.major}.${v.minor}.${v.patch}`;
  }

  return `${v.major}.${v.minor}.${v.patch}-${v.suffix}`;
}

/**
 * Sanitize version, trying to make versiuon to be valid semver.
 *   - replace 'non-semver' symbols with '-' (hyphen)
 *   - parse sanitized string as version number once again
 *
 * @param v: string | versionInfo
 * @returns versionInfo - version info after sanitizing. It might still not be a valid semver!
 */
export function sanitize(v: string | versionInfo): versionInfo {
  var versionString: string

  if (typeof v === "string") {
    versionString = v
    v = parse(versionString)

  } else {
    versionString = v.original
  }

  if (v.semver) {
    return v
  }

  const regex = /[^0-9A-Za-z.+-]/g
  const sanitized = versionString.replace(regex, "-")
  const result = parse(sanitized)
  result.original = versionString

  return result
}

/**
 * Sanitize version and throw an error, if the result is not in semver format.
 *
 * @param v: string | versionInfo
 * @returns versionInfo - version in semver format
 */
export function toSemver(v: string | versionInfo): versionInfo {
  const i = sanitize(v)
  if (i.semver) {
    return i
  }

  var vString: string
  if (typeof v === "string") {
    vString = v
  } else {
    vString = v.original
  }

  throw new Error(`version ${vString} has not semver format and cannot be transformed to semver automatiaclly`)
}
