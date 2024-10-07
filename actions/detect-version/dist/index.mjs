import * as a from "@actions/core";
import V from "@actions/exec";
import * as N from "semver";
import C from "semver";
var o = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, v = {}, u = {}, F = o && o.__createBinding || (Object.create ? function(e, t, r, n) {
  n === void 0 && (n = r);
  var i = Object.getOwnPropertyDescriptor(t, r);
  (!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = { enumerable: !0, get: function() {
    return t[r];
  } }), Object.defineProperty(e, n, i);
} : function(e, t, r, n) {
  n === void 0 && (n = r), e[n] = t[r];
}), I = o && o.__setModuleDefault || (Object.create ? function(e, t) {
  Object.defineProperty(e, "default", { enumerable: !0, value: t });
} : function(e, t) {
  e.default = t;
}), U = o && o.__importStar || function(e) {
  if (e && e.__esModule) return e;
  var t = {};
  if (e != null) for (var r in e) r !== "default" && Object.prototype.hasOwnProperty.call(e, r) && F(t, e, r);
  return I(t, e), t;
};
Object.defineProperty(u, "__esModule", { value: !0 });
u.git = d;
u.fetch = S;
u.revList = j;
u.describe = R;
u.lsRemote = z;
u.tag = B;
u.resolveRef = q;
u.fetchTags = Y;
u.listCommitTags = W;
u.countCommits = Z;
u.currentTag = J;
u.latestTag = A;
u.previousTag = K;
u.ensureHistorySize = Q;
const G = U(V);
async function d(...e) {
  const t = await G.getExecOutput("git", e, {
    ignoreReturnCode: !0
  });
  if (t.exitCode !== 0) {
    const r = `git '${e.join("' '")}'`, n = t.exitCode.toString(), i = t.stderr;
    throw Error(`command "${r}" failed with code '${n}':

${i}`);
  }
  return t;
}
async function S(e) {
  const t = ["fetch"];
  e && e.forceFlag && t.push("--force"), e && e.depth != null && t.push(`--depth=${e.depth}`), e && e.deepen != null && t.push(`--deepen=${e.deepen}`), e && e.remote && t.push(e.remote), e && e.refSpec && t.push(e.refSpec), await d(...t);
}
async function j(e) {
  const t = ["rev-list"];
  e && e.maxCount != null && t.push(`--max-count=${e.maxCount}`), e && e.ref && t.push(e.ref);
  const n = (await d(...t)).stdout.trim();
  return n === "" ? [] : n.split(`
`);
}
async function R(e) {
  const t = ["describe"];
  return e && e.tags && t.push("--tags"), e && e.abbrev != null && t.push(`--abbrev=${e.abbrev}`), e && e.exactMatch && t.push("--exact-match"), e && e.ref && t.push(e.ref), (await d(...t)).stdout.trim();
}
async function z(e) {
  const t = ["ls-remote"];
  e.tagsFlag && t.push("--tags"), e.headsFlag && t.push("--heads"), e.refs && t.push("--refs"), e.quietFlag && t.push("--quiet"), t.push(e.repository), e.refs && t.push(...e.refs);
  const r = await d(...t), n = [];
  for (const i of r.stdout.trim().split(`
`)) {
    const s = i.split("	");
    n.push({ objectSHA: s[0], refName: s[1] });
  }
  return n;
}
async function B(e) {
  const t = ["tag"];
  return e && e.list && t.push("--list"), e && e.pointsAt && t.push(`--points-at=${e.pointsAt}`), e && e.merged && t.push(`--merged=${e.merged}`), e && e.sort && t.push(`--sort=${e.sort}`), e && e.ref && t.push(e.ref), (await d(...t)).stdout.trim();
}
async function q(e = "HEAD") {
  return (await j({ maxCount: 1, ref: e }))[0];
}
async function Y(e = "origin") {
  await S({
    remote: e,
    refSpec: "refs/tags/*:refs/tags/*",
    deepen: 1
  });
}
async function W(e = "HEAD") {
  const t = await B({
    pointsAt: e
  });
  return t ? t.split(`
`) : [];
}
async function Z(e, t) {
  return (await j({ ref: `${e}..${t}` })).length;
}
async function J(e = "HEAD") {
  return await R({
    tags: !0,
    abbrev: 0,
    exactMatch: !0,
    ref: e
  });
}
async function A(e = "HEAD") {
  return await R({
    tags: !0,
    abbrev: 0,
    ref: e
  });
}
async function K(e = "HEAD") {
  return await A(`${e}^`);
}
async function Q(e, t = "origin", r = "HEAD") {
  (await j({
    maxCount: e,
    ref: r
  })).length >= e || await S({
    deepen: e,
    remote: t,
    refSpec: r
  });
}
var x = {};
Object.defineProperty(x, "__esModule", { value: !0 });
x.countOccurrences = X;
function X(e, t) {
  let r = 0, n = 0;
  const i = t.length;
  if (i === 0)
    return 0;
  let s = 0;
  for (; (r = e.indexOf(t, n)) > -1; )
    s = s + 1, n = r + i;
  return s;
}
var m = {}, k = o && o.__createBinding || (Object.create ? function(e, t, r, n) {
  n === void 0 && (n = r);
  var i = Object.getOwnPropertyDescriptor(t, r);
  (!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = { enumerable: !0, get: function() {
    return t[r];
  } }), Object.defineProperty(e, n, i);
} : function(e, t, r, n) {
  n === void 0 && (n = r), e[n] = t[r];
}), ee = o && o.__setModuleDefault || (Object.create ? function(e, t) {
  Object.defineProperty(e, "default", { enumerable: !0, value: t });
} : function(e, t) {
  e.default = t;
}), te = o && o.__importStar || function(e) {
  if (e && e.__esModule) return e;
  var t = {};
  if (e != null) for (var r in e) r !== "default" && Object.prototype.hasOwnProperty.call(e, r) && k(t, e, r);
  return ee(t, e), t;
};
Object.defineProperty(m, "__esModule", { value: !0 });
m.parse = T;
m.compare = ne;
m.toString = ie;
m.sanitize = y;
m.toSemver = se;
const re = te(C);
function p(e) {
  const t = Number(e);
  return !Number.isNaN(t);
}
function T(e) {
  const t = {
    major: 0,
    minor: 0,
    patch: 0,
    suffix: "",
    // part of the version string left after main fields parsing
    original: e,
    // original version string parsed by parser
    semver: !1
    // the version seems to conform with semver
  }, r = re.parse(e);
  if (r)
    return t.major = r.major, t.minor = r.minor, t.patch = r.patch, t.semver = !0, r.prerelease.length > 0 && (t.suffix += r.prerelease.join(".")), r.build.length > 0 && (r.build.map((s) => s.toString()), t.suffix += "+" + r.build.join(".")), t;
  const n = e.split(".");
  if (p(n[0]) ? t.major = Number(n[0]) : t.suffix = e, n.length === 1)
    return t.semver = p(n[0]), t;
  if (!p(n[1])) {
    const s = H(n[1]);
    return Number.isNaN(s.v) ? (t.suffix = n.slice(1).join("."), t) : (t.minor = s.v, t.suffix = [s.s].concat(n.slice(2)).join("."), t.semver = !0, t);
  }
  if (t.minor = Number(n[1]), n.length === 2)
    return t.semver = !0, t;
  if (p(n[2]))
    return t.patch = Number(n[2]), t.semver = n.length === 3, n.length > 3 && (t.suffix = n.slice(3).join(".")), t;
  const i = H(n[2]);
  return Number.isNaN(i.v) ? (t.suffix = n.slice(2).join("."), t) : (t.patch = i.v, t.suffix = [i.s].concat(n.slice(3)).join("."), t.semver = !0, t);
}
function H(e) {
  const t = e.split("-");
  return t.length === 1 ? p(e) ? {
    v: Number(e),
    s: ""
  } : {
    v: NaN,
    s: e
  } : p(t[0]) ? {
    v: Number(t[0]),
    s: t.slice(1).join("-")
  } : {
    v: NaN,
    s: e
  };
}
function ne(e, t, r) {
  return r === void 0 && (r = !0), r && (e = y(e), t = y(t)), e.semver && !t.semver ? 1 : t.semver && !e.semver ? -1 : !e.semver && !t.semver ? e.original < t.original ? -1 : e.original > t.original ? 1 : 0 : e.major < t.major ? -1 : e.major > t.major ? 1 : e.minor < t.minor ? -1 : e.minor > t.minor ? 1 : e.patch < t.patch ? -1 : e.patch > t.patch ? 1 : t.suffix === "" && e.suffix !== "" ? -1 : e.suffix === "" && t.suffix !== "" ? 1 : e.suffix < t.suffix ? -1 : e.suffix > t.suffix ? 1 : 0;
}
function ie(e) {
  return e.semver ? e.suffix === "" ? `${e.major}.${e.minor}.${e.patch}` : `${e.major}.${e.minor}.${e.patch}-${e.suffix}` : e.original;
}
function y(e) {
  var t;
  if (typeof e == "string" ? (t = e, e = T(t)) : t = e.original, e.semver)
    return e;
  const r = /[^0-9A-Za-z.+-]/g, n = t.replace(r, "-"), i = T(n);
  return i.original = t, i;
}
function se(e) {
  const t = y(e);
  if (t.semver)
    return t;
  var r;
  throw typeof e == "string" ? r = e : r = e.original, new Error(`version ${r} has not semver format and cannot be transformed to semver automatiaclly`);
}
var ae = o && o.__createBinding || (Object.create ? function(e, t, r, n) {
  n === void 0 && (n = r);
  var i = Object.getOwnPropertyDescriptor(t, r);
  (!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = { enumerable: !0, get: function() {
    return t[r];
  } }), Object.defineProperty(e, n, i);
} : function(e, t, r, n) {
  n === void 0 && (n = r), e[n] = t[r];
}), oe = o && o.__setModuleDefault || (Object.create ? function(e, t) {
  Object.defineProperty(e, "default", { enumerable: !0, value: t });
} : function(e, t) {
  e.default = t;
}), E = o && o.__importStar || function(e) {
  if (e && e.__esModule) return e;
  var t = {};
  if (e != null) for (var r in e) r !== "default" && Object.prototype.hasOwnProperty.call(e, r) && ae(t, e, r);
  return oe(t, e), t;
};
Object.defineProperty(v, "__esModule", { value: !0 });
var f = v.version = v.string = c = v.git = void 0;
const ue = E(u);
var c = v.git = ue;
const ce = E(x);
v.string = ce;
const fe = E(m);
f = v.version = fe;
async function le() {
  const t = (await c.tag({ list: !0 })).split(`
`), r = {};
  for (const n of t) {
    let i = n;
    n.startsWith("v") && (i = n.slice(1)), r[n] = f.parse(i);
  }
  return r;
}
function ge(e) {
  const t = Object.entries(e);
  return t.sort((r, n) => f.compare(r[1], n[1])), t[t.length - 1][0];
}
async function D() {
  const e = process.env.GITHUB_REF_TYPE, t = process.env.GITHUB_SHA, r = process.env.GITHUB_EVENT_NAME;
  let n;
  return e !== "branch" ? !1 : (r === "pull_request" ? n = process.env.GITHUB_HEAD_REF : n = process.env.GITHUB_REF_NAME, await c.fetch({
    deepen: 1,
    remote: "origin",
    refSpec: n
  }), await c.resolveRef(`origin/${n}`) === t);
}
function ve(e, t) {
  const r = Object.values(e);
  r.sort(f.compare);
  for (let n = r.length - 1; n >= 0; n--) {
    const i = r[n];
    if (i.major === t.major)
      return f.compare(i, t) === 0;
  }
  return !1;
}
function me(e) {
  return e.filter((t) => N.valid(t) !== null).sort(N.rcompare);
}
async function he(e) {
  const t = process.env.GITHUB_REF_TYPE, r = process.env.GITHUB_REF_NAME;
  return t === "tag" && await c.fetch({
    remote: "origin",
    refSpec: `refs/tags/${r}:refs/tags/${r}`,
    deepen: 1,
    forceFlag: !0
  }), await c.fetchTags(), c.ensureHistorySize(e);
}
async function M(e, t) {
  const r = process.env.GITHUB_REF_NAME, n = f.sanitize(r), i = await c.countCommits(t, "HEAD");
  return {
    major: e.major,
    minor: e.minor,
    patch: e.patch,
    suffix: `${i}-${n}`,
    original: `${e.original}-${i}-${n}`,
    semver: !0
  };
}
async function pe(e) {
  const t = process.env.GITHUB_REF_TYPE, r = process.env.GITHUB_REF_NAME, n = process.env.GITHUB_RUN_NUMBER, i = await c.resolveRef("HEAD"), s = `${n}-${i.substring(0, 8)}`, $ = f.sanitize(s), l = t === "branch" && r === e, _ = await D();
  L({
    current: {
      v: $,
      tag: "",
      sha: i
    },
    previous: {
      v: f.parse("unknown"),
      tag: "",
      sha: "unknown"
    },
    latest: {
      v: f.parse("unknown"),
      tag: "",
      sha: "unknown"
    },
    isRelease: l,
    isBranchHead: _,
    isLatestVersion: _ && l,
    isLatestMajor: _ && l
  });
}
async function O(e, t) {
  const r = t[e];
  return r && r.original ? f.sanitize(r.original) : null;
}
async function de(e) {
  await he(e);
  const t = await le();
  let r = ge(t), n = await c.resolveRef(r), i = await O(r, t);
  if (!i)
    throw new Error("Failed to parse latest version.");
  if (r.toLowerCase() === "nightly") {
    const b = me(Object.keys(t)).find(
      (P) => P.toLowerCase() !== "nightly"
    );
    b && (r = b, i = t[b], n = await c.resolveRef(b));
  }
  let s = await c.previousTag();
  const $ = await c.resolveRef(s);
  let l = await O(s, t);
  if (s.toLowerCase() === "nightly" && (l = i, s = r), !l)
    throw new Error("Failed to parse previous version.");
  const _ = await c.resolveRef("HEAD");
  let w = "", h;
  try {
    w = await c.currentTag();
    const g = await O(w, t);
    if (!g)
      throw new Error("Failed to parse current version.");
    h = g, w.toLowerCase() === "nightly" && l && (h = await M(l, s));
  } catch (g) {
    if (!(g instanceof Error))
      throw g;
    if (a.notice(
      `Current commit seems to have no tag. Version number will be generated.
${g.message}`
    ), !l)
      throw new Error("Previous version is required but not available.");
    h = await M(l, s);
  }
  L({
    current: {
      v: h,
      tag: w,
      sha: _
    },
    previous: {
      v: l,
      tag: s,
      sha: $
    },
    latest: {
      v: i,
      tag: r,
      sha: n
    },
    isRelease: w !== "",
    isBranchHead: await D(),
    isLatestVersion: f.compare(i, h) === 0,
    isLatestMajor: ve(t, h)
  });
}
function L(e) {
  a.debug(
    `current version: '${e.current.v.original}'
current tag: '${e.current.tag}'

previous version: '${e.previous.v.original}'
previous tag: '${e.previous.tag}'

latest version: '${e.latest.v.original}'
latest tag: '${e.latest.tag}'
`
  ), a.setOutput("current-version", f.toString(e.current.v)), a.setOutput("current-tag", e.current.tag), a.setOutput("current-sha", e.current.sha), a.setOutput("previous-version", f.toString(e.previous.v)), a.setOutput("previous-tag", e.previous.tag), a.setOutput("previous-sha", e.previous.sha), a.setOutput("latest-version", f.toString(e.latest.v)), a.setOutput("latest-tag", e.latest.tag), a.setOutput("latest-sha", e.latest.sha), a.setOutput("is-release", e.isRelease), a.setOutput("is-branch-head", e.isBranchHead), a.setOutput("is-latest-version", e.isLatestVersion), a.setOutput("is-latest-major", e.isLatestMajor);
}
async function _e() {
  const e = parseInt(a.getInput("fetch-depth")), t = a.getInput("branch-versioning");
  if (t !== "") {
    await pe(t);
    return;
  }
  await de(e);
}
async function we() {
  try {
    await _e();
  } catch (e) {
    if (e instanceof Error) {
      a.setFailed(e.message);
      return;
    }
    throw e;
  }
}
we();
//# sourceMappingURL=index.mjs.map
