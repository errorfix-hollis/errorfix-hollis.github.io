/* errorfix developer tools. Everything runs locally in your browser; nothing is sent to a server. */
(function () {
'use strict';
var T = {};

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function two(n) { return (n < 10 ? '0' : '') + n; }
function listJoin(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
T.esc = esc;

/* ---------------- JSON ---------------- */
function lineCol(text, pos) {
  var line = 1, col = 1;
  for (var i = 0; i < pos && i < text.length; i++) { if (text[i] === '\n') { line++; col = 1; } else col++; }
  return { line: line, col: col };
}
T.lineCol = lineCol;

// Strict JSON scanner that reports a precise position and a human-readable message.
function jsonLocate(s) {
  var i = 0, n = s.length;
  function fail(msg, at) { var e = new Error(msg); e.pos = at === undefined ? i : at; throw e; }
  function ws() { while (i < n) { var c = s[i]; if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++; else break; } }
  function word(w) { if (s.substr(i, w.length) === w) { i += w.length; return true; } return false; }
  function value() {
    ws();
    if (i >= n) fail('Unexpected end of input: expected a value');
    var c = s[i];
    if (c === '{') return obj();
    if (c === '[') return arr();
    if (c === '"') return str();
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    if (word('true') || word('false') || word('null')) return;
    if (c === "'") fail('Strings must use double quotes ("), not single quotes');
    if (c === '/') fail('Comments are not allowed in JSON');
    if (c === '\uFEFF') fail('Byte order mark (BOM) found: remove the invisible U+FEFF character');
    var w = s.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (w) {
      if (/^(undefined|NaN|Infinity)$/.test(w[0])) fail('"' + w[0] + '" is not a valid JSON value');
      if (/^(True|False|None)$/.test(w[0])) fail('"' + w[0] + '" is Python, not JSON: use true, false or null');
      fail('Unexpected word "' + w[0] + '": strings must be in double quotes');
    }
    fail('Unexpected character "' + c + '": expected a value');
  }
  function obj() {
    i++; ws();
    if (s[i] === '}') { i++; return; }
    for (;;) {
      ws();
      if (i >= n) fail('Unexpected end of input: expected a property name');
      if (s[i] === '}') fail('Trailing comma before "}" is not allowed in JSON');
      if (s[i] === "'") fail('Property names must use double quotes ("), not single quotes');
      if (s[i] !== '"') fail('Expected a double-quoted property name');
      str(); ws();
      if (i >= n) fail('Unexpected end of input: expected ":"');
      if (s[i] !== ':') fail('Expected ":" after property name');
      i++; value(); ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === '}') { i++; return; }
      if (i >= n) fail('Unexpected end of input: expected "," or "}" (unclosed object)');
      fail('Expected "," or "}" after property value (missing comma?)');
    }
  }
  function arr() {
    i++; ws();
    if (s[i] === ']') { i++; return; }
    for (;;) {
      ws();
      if (s[i] === ']') fail('Trailing comma before "]" is not allowed in JSON');
      value(); ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ']') { i++; return; }
      if (i >= n) fail('Unexpected end of input: expected "," or "]" (unclosed array)');
      fail('Expected "," or "]" after array element (missing comma?)');
    }
  }
  function str() {
    var start = i; i++;
    while (i < n) {
      var c = s[i];
      if (c === '"') { i++; return; }
      if (c === '\\') {
        var e = s[i + 1];
        if (e !== undefined && '"\\/bfnrt'.indexOf(e) >= 0) { i += 2; continue; }
        if (e === 'u') { if (/^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) { i += 6; continue; } fail('Invalid \\u escape: expected 4 hex digits'); }
        fail('Invalid escape sequence "\\' + (e || '') + '"');
      }
      if (c < ' ') fail(c === '\n' ? 'Unescaped line break inside a string (missing closing quote?)' : 'Unescaped control character inside a string (use \\t, \\n, ...)');
      i++;
    }
    fail('Unterminated string: missing closing double quote', start);
  }
  function num() {
    var re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    re.lastIndex = i;
    var r = re.exec(s);
    if (!r || r[0] === '' || r[0] === '-') fail('Invalid number');
    var nx = s[i + r[0].length];
    if (nx !== undefined && /[0-9.eExX]/.test(nx)) fail('Invalid number (no leading zeros, hex or trailing dots in JSON)');
    i += r[0].length;
  }
  try {
    value(); ws();
    if (i < n) fail('Unexpected data after the end of the JSON value (missing comma or extra bracket?)');
    return null;
  } catch (e) { return { message: e.message, pos: e.pos }; }
}
T.jsonLocate = jsonLocate;

T.jsonCheck = function (text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (err) {
    var loc = jsonLocate(text);
    if (!loc) { var m = /position (\d+)/.exec(err.message); loc = { message: err.message, pos: m ? +m[1] : 0 }; }
    var lc = lineCol(text, loc.pos);
    return { ok: false, message: loc.message, native: err.message, pos: loc.pos, line: lc.line, col: lc.col };
  }
};
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sortKeys(v[k]); }); return o; }
  return v;
}
T.jsonFormat = function (value, indent, sort) { return JSON.stringify(sort ? sortKeys(value) : value, null, indent); };

/* ---------------- Cron ---------------- */
var DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
var MON_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
var DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var CF = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MON_NAMES },
  { name: 'day-of-week', min: 0, max: 7, names: DOW_NAMES, dow: true }
];
var MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
T.CRON_MACROS = MACROS;

function cronNum(tok, f) {
  var t = tok.toUpperCase();
  if (f.names && t.length === 3) { var k = f.names.indexOf(t); if (k >= 0) return f.dow ? k : k + 1; }
  if (!/^\d+$/.test(t)) throw new Error('Invalid value "' + tok + '" in the ' + f.name + ' field');
  var v = +t;
  if (v < f.min || v > f.max) throw new Error(cap(f.name) + ' value ' + v + ' is out of range (' + f.min + '-' + f.max + ')');
  return v;
}
function parseCronPart(p, f) {
  var m = p.match(/^([^\/]+)(?:\/(\d+))?$/);
  if (!m) throw new Error('Invalid ' + f.name + ' field part "' + p + '"');
  var r = { step: m[2] !== undefined ? +m[2] : 0 };
  if (m[2] !== undefined && r.step < 1) throw new Error('Step must be at least 1 in "' + p + '"');
  var hiAll = f.dow ? 6 : f.max;
  if (m[1] === '*' || m[1] === '?') { r.kind = 'all'; r.lo = f.min; r.hi = hiAll; }
  else if (m[1].indexOf('-') > 0) {
    var ab = m[1].split('-');
    if (ab.length !== 2) throw new Error('Invalid range "' + m[1] + '"');
    r.kind = 'range'; r.lo = cronNum(ab[0], f); r.hi = cronNum(ab[1], f);
    if (r.lo > r.hi) throw new Error('Range "' + m[1] + '" goes backwards in the ' + f.name + ' field');
  } else {
    r.lo = cronNum(m[1], f);
    if (r.step) { r.kind = 'start'; r.hi = hiAll; } else { r.kind = 'one'; r.hi = r.lo; }
  }
  return r;
}
function parseCronField(str, f) {
  if (str === '') throw new Error('Empty ' + f.name + ' field');
  var parts = str.split(',').map(function (p) { if (p === '') throw new Error('Empty list item in the ' + f.name + ' field'); return parseCronPart(p, f); });
  var set = [];
  parts.forEach(function (r) { for (var v = r.lo; v <= r.hi; v += (r.step || 1)) set[(f.dow && v === 7) ? 0 : v] = true; });
  return { raw: str, parts: parts, star: str[0] === '*' || str[0] === '?', any: str === '*' || str === '?', set: set };
}
T.parseCron = function (expr) {
  var e = String(expr).trim().replace(/\s+/g, ' ');
  if (!e) throw new Error('Enter a cron expression, e.g. */15 * * * *');
  var low = e.toLowerCase();
  if (low === '@reboot') return { reboot: true, expr: e };
  if (low[0] === '@') { if (!MACROS[low]) throw new Error('Unknown macro "' + e + '". Known: @reboot, ' + Object.keys(MACROS).join(', ')); e = MACROS[low]; }
  var f = e.split(' ');
  if (f.length === 6) throw new Error('6 fields found. Standard (Vixie/Linux) cron has 5 fields: minute hour day-of-month month day-of-week. A leading seconds field is Quartz/Spring syntax; a trailing year is not supported by cron.');
  if (f.length !== 5) throw new Error('Expected 5 fields (minute hour day-of-month month day-of-week), found ' + f.length);
  return { expr: e, fields: f.map(function (s, k) { return parseCronField(s, CF[k]); }) };
};

function partDesc(r, f, fmt, unit, units) {
  if (r.kind === 'one') return fmt(r.lo);
  var every = r.step === 1 ? 'every ' + unit : 'every ' + r.step + ' ' + units;
  if (r.kind === 'all') return every;
  if (r.kind === 'range') return (r.step ? every + ' from ' : '') + fmt(r.lo) + ' through ' + fmt(r.hi);
  return every + ' starting at ' + fmt(r.lo);
}
function hhmm(h, m) { return two(h) + ':' + two(m); }
T.describeCron = function (expr) {
  var c = T.parseCron(expr);
  if (c.reboot) return 'Once, when the cron daemon starts (at boot)';
  var F = c.fields, mi = F[0], ho = F[1], dom = F[2], mon = F[3], dow = F[4];
  var allOne = function (fl) { return fl.parts.every(function (p) { return p.kind === 'one'; }); };
  var vals = function (fl) { return fl.parts.map(function (p) { return p.lo; }); };
  var time;
  if (allOne(mi) && allOne(ho) && mi.parts.length * ho.parts.length <= 8) {
    var t = [];
    vals(ho).sort(function (a, b) { return a - b; }).forEach(function (h) { vals(mi).sort(function (a, b) { return a - b; }).forEach(function (m) { t.push(hhmm(h, m)); }); });
    time = 'At ' + listJoin(t);
  } else {
    var mp;
    if (mi.any) mp = 'Every minute';
    else if (allOne(mi)) mp = 'At minute' + (mi.parts.length > 1 ? 's ' : ' ') + listJoin(vals(mi).map(String));
    else if (mi.parts.length === 1 && mi.parts[0].kind === 'range' && !mi.parts[0].step) mp = 'Every minute from ' + mi.parts[0].lo + ' through ' + mi.parts[0].hi;
    else if (mi.parts.length === 1 && mi.parts[0].kind !== 'one') mp = cap(partDesc(mi.parts[0], CF[0], String, 'minute', 'minutes'));
    else mp = 'At minutes ' + listJoin(mi.parts.map(function (p) { return partDesc(p, CF[0], String, 'minute', 'minutes'); }));
    var pastHour = allOne(mi);
    var hp = '';
    var hfmt = function (h) { return hhmm(h, 0); };
    if (ho.any) hp = pastHour ? ' past every hour' : '';
    else if (ho.parts.length === 1) {
      var p = ho.parts[0];
      if (p.kind === 'one') hp = pastHour ? ' past hour ' + two(p.lo) + ' (' + hhmm(p.lo, 0) + '-' + hhmm(p.lo, 59) + ')' : ', between ' + hhmm(p.lo, 0) + ' and ' + hhmm(p.lo, 59);
      else if (p.kind === 'range' && !p.step) hp = pastHour ? ' past every hour from ' + hfmt(p.lo) + ' through ' + hfmt(p.hi) : ', between ' + hhmm(p.lo, 0) + ' and ' + hhmm(p.hi, 59);
      else hp = (pastHour ? ' past ' : ', ') + partDesc(p, CF[1], hfmt, 'hour', 'hours');
    } else hp = (pastHour ? ' past hours ' : ', during hours ') + listJoin(ho.parts.map(function (p) { return partDesc(p, CF[1], String, 'hour', 'hours'); }));
    time = mp + hp;
  }
  var out = [time];
  var dname = function (v) { return DOW_FULL[v % 7]; };
  var domTxt = function () {
    if (dom.parts.length === 1 && dom.parts[0].kind === 'all') return 'every ' + (dom.parts[0].step === 1 ? 'day' : dom.parts[0].step + ' days') + ' of the month (starting on the 1st)';
    var ones = dom.parts.every(function (p) { return p.kind === 'one'; });
    return 'on ' + (ones ? 'day' + (dom.parts.length > 1 ? 's ' : ' ') : '') + listJoin(dom.parts.map(function (p) { return partDesc(p, CF[2], function (v) { return (p.kind === 'one' ? '' : 'day ') + v; }, 'day', 'days'); })) + ' of the month';
  };
  var dowTxt = function () { return 'on ' + listJoin(dow.parts.map(function (p) { return partDesc(p, CF[4], dname, 'day of the week', 'days of the week'); })); };
  if (!dom.any && !dow.any) {
    if (dom.star || dow.star) out.push(domTxt(), dowTxt());
    else out.push(domTxt() + ' and ' + dowTxt() + ' (either one matching is enough)');
  } else if (!dom.any) out.push(domTxt());
  else if (!dow.any) out.push(dowTxt());
  if (!mon.any) out.push((mon.parts[0].kind === 'all' ? '' : 'in ') + listJoin(mon.parts.map(function (p) { return partDesc(p, CF[3], function (v) { return MON_FULL[v - 1]; }, 'month', 'months'); })));
  return out.join(', ');
};

T.cronNext = function (expr, from, count) {
  var c = T.parseCron(expr);
  if (c.reboot) return [];
  var F = c.fields, res = [];
  var d = new Date(from.getTime());
  d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  var limit = from.getTime() + 6 * 366 * 864e5, guard = 0;
  var dayOk = function (x) {
    var a = !!F[2].set[x.getDate()], b = !!F[4].set[x.getDay()];
    if (F[2].star || F[4].star) return a && b;
    return a || b;
  };
  while (res.length < count && d.getTime() <= limit && guard++ < 500000) {
    if (!F[3].set[d.getMonth() + 1]) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dayOk(d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!F[1].set[d.getHours()]) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!F[0].set[d.getMinutes()]) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    res.push(new Date(d.getTime()));
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return res;
};

/* ---------------- chmod ---------------- */
T.octalToSymbolic = function (oct) {
  oct = String(oct).trim();
  if (!/^[0-7]{3,4}$/.test(oct)) throw new Error('Octal mode must be 3 or 4 digits from 0 to 7, e.g. 755 or 4755');
  if (oct.length === 3) oct = '0' + oct;
  var sp = +oct[0], out = '';
  for (var k = 0; k < 3; k++) {
    var d = +oct[k + 1];
    out += (d & 4 ? 'r' : '-') + (d & 2 ? 'w' : '-');
    var x = d & 1, special = k === 0 ? sp & 4 : k === 1 ? sp & 2 : sp & 1;
    out += special ? (k === 2 ? (x ? 't' : 'T') : (x ? 's' : 'S')) : (x ? 'x' : '-');
  }
  return out;
};
T.symbolicToOctal = function (sym) {
  sym = String(sym).trim();
  if (sym.length === 10) sym = sym.slice(1); // drop file type from ls -l output
  if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(sym)) throw new Error('Symbolic mode must look like rwxr-xr-x (9 characters, optionally with s/S/t/T)');
  var sp = 0, digits = '';
  for (var k = 0; k < 3; k++) {
    var t = sym.substr(k * 3, 3), d = 0;
    if (t[0] === 'r') d += 4;
    if (t[1] === 'w') d += 2;
    if (/[xst]/.test(t[2])) d += 1;
    if (/[sStT]/.test(t[2])) sp += [4, 2, 1][k];
    digits += d;
  }
  return sp ? sp + digits : digits;
};
T.chmodSymbolicArg = function (oct) {
  var s = T.octalToSymbolic(oct), parts = [];
  ['u', 'g', 'o'].forEach(function (who, k) {
    var t = s.substr(k * 3, 3), p = '';
    if (t[0] === 'r') p += 'r';
    if (t[1] === 'w') p += 'w';
    if (/[xst]/.test(t[2])) p += 'x';
    if (/[sS]/.test(t[2])) p += 's';
    if (/[tT]/.test(t[2])) p += 't';
    parts.push(who + '=' + p);
  });
  return parts.join(',');
};

/* ---------------- Unix time ---------------- */
T.tsToMs = function (n) {
  var a = Math.abs(n);
  if (a < 1e11) return { ms: n * 1000, unit: 'seconds' };
  if (a < 1e14) return { ms: n, unit: 'milliseconds' };
  if (a < 1e17) return { ms: n / 1000, unit: 'microseconds' };
  return { ms: n / 1e6, unit: 'nanoseconds' };
};
T.relTime = function (ms, now) {
  var diff = (ms - now) / 1000, a = Math.abs(diff);
  if (a < 1) return 'now';
  var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  for (var k = 0; k < units.length; k++) {
    if (a >= units[k][1]) { var v = Math.floor(a / units[k][1]); var s = v + ' ' + units[k][0] + (v > 1 ? 's' : ''); return diff < 0 ? s + ' ago' : 'in ' + s; }
  }
};
T.parseDateInput = function (str, utc) {
  str = String(str).trim();
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/);
  if (m) {
    var a = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0') + '00').slice(0, 3)];
    if (utc) return Date.UTC(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
    return new Date(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).getTime();
  }
  return Date.parse(str);
};

/* ---------------- Base64 ---------------- */
function bytesToBin(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; }
T.b64encodeBytes = function (bytes, urlsafe) {
  var b = btoa(bytesToBin(bytes));
  return urlsafe ? b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b;
};
T.b64encode = function (str, urlsafe) { return T.b64encodeBytes(new TextEncoder().encode(str), urlsafe); };
T.b64decodeBytes = function (str) {
  var s = String(str).replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  var bad = s.search(/[^A-Za-z0-9+\/=]/);
  if (bad >= 0) throw new Error('Invalid Base64 character "' + s[bad] + '" at position ' + bad);
  if (/=[^=]/.test(s) || /={3,}$/.test(s)) throw new Error('Padding "=" can only appear at the end (at most two)');
  s = s.replace(/=+$/, '');
  if (s.length % 4 === 1) throw new Error('Invalid Base64 length: input looks truncated');
  while (s.length % 4) s += '=';
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
T.utf8Decode = function (bytes) {
  try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch (e) { return { ok: false, text: new TextDecoder('utf-8').decode(bytes) }; }
};
T.b64decode = function (str) { return T.utf8Decode(T.b64decodeBytes(str)); };
T.hex = function (bytes, max) { var a = []; for (var i = 0; i < Math.min(bytes.length, max || 1e9); i++) a.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)); return a.join(' '); };

/* ---------------- URL ---------------- */
T.urlDecode = function (s, plus) {
  if (plus) s = s.replace(/\+/g, ' ');
  try { return decodeURIComponent(s); } catch (e) {
    var m = /%(?![0-9a-fA-F]{2})/.exec(s);
    throw new Error(m ? 'Malformed escape: "%" at position ' + m.index + ' is not followed by two hex digits (encode a literal % as %25)' : 'Malformed percent-encoding: the bytes are not valid UTF-8');
  }
};
T.parseQuery = function (s) {
  s = String(s).trim();
  var q = s, h = s.indexOf('#'); if (h >= 0) q = q.slice(0, h);
  var i = q.indexOf('?'); if (i >= 0) q = q.slice(i + 1);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q)) q = '';
  var out = [];
  new URLSearchParams(q).forEach(function (v, k) { out.push([k, v]); });
  return out;
};

/* ---------------- JWT ---------------- */
function b64urlJson(part, what) {
  var bytes;
  try { bytes = T.b64decodeBytes(part); } catch (e) { throw new Error(what + ' is not valid Base64URL: ' + e.message); }
  var t = T.utf8Decode(bytes).text;
  try { return JSON.parse(t); } catch (e) { throw new Error(what + ' decoded, but it is not valid JSON'); }
}
T.jwtDecode = function (token) {
  var t = String(token).trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
  if (!t) throw new Error('Paste a JWT (three Base64URL parts separated by dots)');
  var p = t.split('.');
  if (p.length === 5) throw new Error('This has 5 parts, so it is an encrypted JWE token; its payload cannot be read without the decryption key');
  if (p.length !== 3) throw new Error('A JWT has 3 parts separated by dots (header.payload.signature); this has ' + p.length);
  return { header: b64urlJson(p[0], 'Header'), payload: b64urlJson(p[1], 'Payload'), signature: p[2] };
};
T.jwtStatus = function (payload, nowSec) {
  if (typeof payload.exp === 'number' && payload.exp <= nowSec) return { state: 'expired', text: 'Expired ' + T.relTime(payload.exp * 1000, nowSec * 1000) };
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return { state: 'notyet', text: 'Not valid yet (nbf is ' + T.relTime(payload.nbf * 1000, nowSec * 1000) + ')' };
  if (typeof payload.exp === 'number') return { state: 'valid', text: 'Not expired: expires ' + T.relTime(payload.exp * 1000, nowSec * 1000) };
  return { state: 'noexp', text: 'No exp claim: this token never expires by time' };
};

/* ---------------- Regex ---------------- */
T.regexMatches = function (pattern, flags, text, limit) {
  var re = new RegExp(pattern, flags), out = [];
  limit = limit || 1000;
  var global = re.global || re.sticky;
  for (;;) {
    var m = re.exec(text);
    if (!m) break;
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1), named: m.groups || null });
    if (!global || out.length >= limit) break;
    if (m[0] === '') re.lastIndex = m.index + ((re.unicode || re.unicodeSets) && text.codePointAt(m.index) > 0xffff ? 2 : 1);
  }
  return out;
};

/* ---------------- YAML ---------------- */
function yamlErr(msg, line, col) { var e = new Error(msg); e.line = line; e.col = col; e.yaml = true; return e; }
var Y11_BOOL = /^(yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|y|Y|n|N)$/;
function yResolve(t, warn) {
  if (t === '' || t === '~' || /^(null|Null|NULL)$/.test(t)) return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^[-+]?[0-9]+$/.test(t)) {
    if (warn && /^[-+]?0[0-9]+$/.test(t)) warn('"' + t + '" has a leading zero: YAML 1.2 reads it as the decimal ' + Number(t) + ', but YAML 1.1 parsers (PyYAML, docker-compose v1) read it as octal' + (/^[-+]?0[0-7]+$/.test(t) ? ' (' + parseInt(t, 8) + ')' : '') + '. Quote it if it is a string (zip code, file mode, ID)');
    if (warn && Math.abs(Number(t)) > 9007199254740991) warn('"' + t + '" is larger than 2^53 and loses precision as a JSON/JavaScript number. Quote it if it is an ID');
    return Number(t);
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^0o[0-7]+$/.test(t)) return parseInt(t.slice(2), 8);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(t)) return Number(t);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(t)) return t[0] === '-' ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(t)) return NaN;
  if (warn && /^(yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/.test(t)) warn('"' + t + '" is a string in YAML 1.2, but YAML 1.1 parsers (PyYAML, older tools) turn it into the boolean ' + /^(y|on)/i.test(t) + '. Quote it, or use true/false');
  if (warn && /^[0-9]+(:[0-5]?[0-9])+$/.test(t)) warn('"' + t + '" is a string in YAML 1.2, but YAML 1.1 parsers read unquoted values like this as a base-60 number. Quote port mappings and times, e.g. "' + t + '"');
  return t;
}
function ySet(o, k, v) { if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); else o[k] = v; }
var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

T.yamlParse = function (src) {
  src = String(src);
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
  var L = src.split(/\r\n|\r|\n/), li = 0, anchors = {}, warnings = [];
  if (L.length > 1 && L[L.length - 1] === '') L.pop();
  function fail(msg, l, c) { throw yamlErr(msg, (l === undefined ? li : l) + 1, (c || 0) + 1); }
  function warnAt(l) { return function (m) { warnings.push({ line: l + 1, message: m }); }; }
  function ind(s) { var k = 0; while (s.charCodeAt(k) === 32) k++; return k; }
  function isBlank(k) { return /^[ \t]*(#.*)?$/.test(L[k]); }
  function isMarker(k) { return k < L.length && /^(---|\.\.\.)([ \t]|$)/.test(L[k]); }
  function skipBlank() { while (li < L.length && isBlank(li) && !isMarker(li)) li++; }
  function atEnd() { return li >= L.length || isMarker(li); }
  function checkTab(k) {
    var s = L[k], n = ind(s);
    if (s[n] === '\t') fail('Tab character used for indentation. YAML allows only spaces for indentation: replace the tab with spaces (set your editor to "indent using spaces")', k, n);
  }
  function isDash(s, c) { return s[c] === '-' && (c + 1 >= s.length || s[c + 1] === ' ' || s[c + 1] === '\t'); }
  function commentIdx(s, from) {
    for (var j = from; j < s.length; j++) if (s[j] === '#' && (j === from || s[j - 1] === ' ' || s[j - 1] === '\t')) return j;
    return s.length;
  }
  function restOk(s, c) { return /^[ \t]*(#.*)?$/.test(s.slice(c)); }

  var ESC = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' };
  function quotedAt(line, col, single) {
    var q = L[line][col], i = col + 1, out = '', s = L[line], sl = line;
    for (;;) {
      if (i >= s.length) {
        if (single) throw yamlErr('multi-line', 0, 0);
        out = out.replace(/[ \t]+$/, '');
        line++;
        var blanks = 0;
        while (line < L.length && /^[ \t]*$/.test(L[line])) { blanks++; line++; }
        if (line >= L.length || isMarker(line)) fail('Unterminated ' + (q === '"' ? 'double' : 'single') + '-quoted string: the closing ' + q + ' is missing', sl, col);
        out += blanks ? '\n'.repeat(blanks) : ' ';
        s = L[line]; i = 0; while (s[i] === ' ' || s[i] === '\t') i++;
        continue;
      }
      var c = s[i];
      if (q === "'") {
        if (c === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
        out += c; i++; continue;
      }
      if (c === '"') { i++; break; }
      if (c === '\\') {
        var e = s[i + 1];
        if (e === undefined) {
          if (single) throw yamlErr('multi-line', 0, 0);
          line++; if (line >= L.length) fail('Unterminated double-quoted string: the closing " is missing', sl, col);
          s = L[line]; i = 0; while (s[i] === ' ' || s[i] === '\t') i++;
          continue;
        }
        if (hasOwn(ESC, e)) { out += ESC[e]; i += 2; continue; }
        var hl = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
        if (hl) {
          var h = s.substr(i + 2, hl);
          if (!new RegExp('^[0-9a-fA-F]{' + hl + '}$').test(h)) fail('Invalid escape "\\' + e + '": expected ' + hl + ' hex digits', line, i);
          out += String.fromCodePoint(parseInt(h, 16)); i += 2 + hl; continue;
        }
        fail('Invalid escape sequence "\\' + e + '" in a double-quoted string. Escape the backslash as \\\\ or use single quotes (common with Windows paths and regexes)', line, i);
      }
      out += c; i++;
    }
    return { value: out, line: line, col: i };
  }

  function keyAt(k, col) {
    var s = L[k], c = s[col];
    if (c === undefined || c === '#') return null;
    if (c === '"' || c === "'") {
      var r;
      try { r = quotedAt(k, col, true); } catch (e) { if (e.message === 'multi-line') return null; throw e; }
      var j = r.col; while (s[j] === ' ' || s[j] === '\t') j++;
      if (s[j] === ':' && (j + 1 >= s.length || s[j + 1] === ' ' || s[j + 1] === '\t')) return { key: r.value, valCol: j + 1, quoted: true };
      return null;
    }
    if (c === '?' && (col + 1 >= s.length || s[col + 1] === ' ')) fail('Complex mapping keys ("? key") are not supported by this validator', k, col);
    if ('[{|>*!%@`'.indexOf(c) >= 0 || isDash(s, col)) return null;
    var end = commentIdx(s, col);
    for (var j2 = col; j2 < end; j2++) {
      if (s[j2] === ':' && (j2 + 1 >= s.length || s[j2 + 1] === ' ' || s[j2 + 1] === '\t')) return { key: s.slice(col, j2).replace(/[ \t]+$/, ''), valCol: j2 + 1 };
    }
    return null;
  }

  function flowAt(line, col) {
    var p = { l: line, c: col }, sl = line, sc = col;
    function ch() { return p.l < L.length ? L[p.l][p.c] : undefined; }
    function ws() {
      for (;;) {
        if (p.l >= L.length) return;
        var s = L[p.l];
        while (p.c < s.length && (s[p.c] === ' ' || s[p.c] === '\t')) p.c++;
        if (s[p.c] === '#' && (p.c === 0 || /\s/.test(s[p.c - 1]))) p.c = s.length;
        if (p.c < s.length) return;
        p.l++; p.c = 0;
        if (isMarker(p.l)) fail('Document marker inside an unclosed flow collection', p.l, 0);
      }
    }
    function eof() { if (p.l >= L.length) fail('Unexpected end of input inside a flow collection: a closing bracket is missing for the one opened here', sl, sc); }
    function val() {
      ws(); eof();
      var c = ch(), s = L[p.l];
      if (c === '[') {
        p.c++; var arr = [];
        for (;;) {
          ws(); eof();
          if (ch() === ']') { p.c++; return arr; }
          if (ch() === ',') fail('Unexpected "," in a flow sequence (empty entry or double comma)', p.l, p.c);
          var item = val(); ws(); eof();
          if (ch() === ':') { p.c++; var pv = val(); var po = {}; ySet(po, String(item), pv); item = po; ws(); eof(); }
          arr.push(item);
          if (ch() === ',') { p.c++; continue; }
          if (ch() === ']') { p.c++; return arr; }
          fail('Expected "," or "]" in a flow sequence (missing comma or closing bracket?)', p.l, p.c);
        }
      }
      if (c === '{') {
        p.c++; var o = {};
        for (;;) {
          ws(); eof();
          if (ch() === '}') { p.c++; return o; }
          if (ch() === ',') fail('Unexpected "," in a flow mapping (empty entry or double comma)', p.l, p.c);
          var kl = p.l, k = val(), v = null; ws(); eof();
          if (ch() === ':') { p.c++; ws(); eof(); v = (ch() === ',' || ch() === '}') ? null : val(); ws(); eof(); }
          var ks = k === null ? 'null' : typeof k === 'object' ? JSON.stringify(k) : String(k);
          if (hasOwn(o, ks)) warnAt(kl)('Duplicate key "' + ks + '" in flow mapping: the last value wins');
          ySet(o, ks, v);
          if (ch() === ',') { p.c++; continue; }
          if (ch() === '}') { p.c++; return o; }
          fail('Expected "," or "}" in a flow mapping (missing comma, colon or closing brace?)', p.l, p.c);
        }
      }
      if (c === '"' || c === "'") { var r = quotedAt(p.l, p.c); p.l = r.line; p.c = r.col; return r.value; }
      if (c === ']' || c === '}') fail('Unexpected "' + c + '": no matching opening bracket', p.l, p.c);
      if (c === '*') {
        var a = /^\*([^\s,\[\]{}]+)/.exec(s.slice(p.c));
        if (!a || !hasOwn(anchors, a[1])) fail('Unknown alias "' + (a ? a[0] : '*') + '": no matching anchor (&name) defined above', p.l, p.c);
        p.c += a[0].length; return anchors[a[1]];
      }
      var st = p.c;
      while (p.c < s.length) {
        var d = s[p.c];
        if (',[]{}'.indexOf(d) >= 0) break;
        if (d === ':' && (p.c + 1 >= s.length || /[\s,\[\]{}]/.test(s[p.c + 1]))) break;
        if (d === '#' && /\s/.test(s[p.c - 1])) break;
        p.c++;
      }
      return yResolve(s.slice(st, p.c).trim(), warnAt(p.l));
    }
    var v = val();
    return { value: v, line: p.l, col: p.c };
  }

  function blockScalar(col, pInd) {
    var s = L[li], h = /^([|>])([1-9]?)([+-]?)([1-9]?)[ \t]*(#.*)?$/.exec(s.slice(col));
    if (!h) fail('Invalid block scalar header: expected | or > optionally followed by an indentation digit and/or + or - (e.g. |- or >2), then only a comment', li, col);
    var literal = h[1] === '|', chomp = h[3], explicit = +(h[2] || h[4] || 0);
    var base = Math.max(pInd, 0), ci = explicit ? base + explicit : -1, lines = [];
    li++;
    if (ci < 0) {
      for (var j = li; j < L.length; j++) {
        if (/^ *$/.test(L[j])) continue;
        var m = ind(L[j]);
        ci = (m > pInd && !(m === 0 && isMarker(j))) ? m : 1e9;
        if (L[j][m] === '\t' && m <= pInd) ci = 1e9;
        break;
      }
      if (ci < 0) ci = 1e9;
    }
    while (li < L.length) {
      var t = L[li];
      if (/^ *$/.test(t)) { lines.push(t.length > ci ? t.slice(ci) : ''); li++; continue; }
      if (ind(t) < ci || isMarker(li)) break;
      lines.push(t.slice(ci)); li++;
    }
    var end = lines.length;
    while (end > 0 && lines[end - 1] === '') end--;
    var body = lines.slice(0, end), trail = lines.length - end, text;
    if (literal) text = body.join('\n');
    else {
      var lead = 0; while (lead < body.length && body[lead] === '') lead++;
      text = '\n'.repeat(lead) + (lead < body.length ? body[lead] : '');
      var k = lead + 1;
      while (k < body.length) {
        var blanks = 0; while (body[k] === '') { blanks++; k++; }
        var cur = body[k], prev = body[k - blanks - 1];
        if (/^[ \t]/.test(cur) || /^[ \t]/.test(prev)) text += '\n' + '\n'.repeat(blanks);
        else text += blanks ? '\n'.repeat(blanks) : ' ';
        text += cur; k++;
      }
    }
    if (!body.length) return chomp === '+' ? '\n'.repeat(trail) : '';
    if (chomp === '-') return text;
    if (chomp === '+') return text + '\n' + '\n'.repeat(trail);
    return text + '\n';
  }

  function plain(col, pInd) {
    var s = L[li], end = commentIdx(s, col), text = s.slice(col, end).replace(/[ \t]+$/, ''), line0 = li;
    var mm = /:([ \t]|$)/.exec(text);
    if (mm) fail('Mapping values are not allowed here: this value contains ": ". Put the whole value in quotes, e.g. "' + text.replace(/"/g, '\\"') + '", or fix the indentation if it should be a nested key', li, col + mm.index);
    li++;
    if (end < s.length) return yResolve(text, warnAt(line0));
    var out = text, multi = false, pend = 0, j = li;
    while (j < L.length) {
      var t = L[j];
      if (/^[ \t]*$/.test(t)) { pend++; j++; continue; }
      var m = ind(t);
      if (m <= pInd || isMarker(j)) break;
      var x = m; while (t[x] === ' ' || t[x] === '\t') x++;
      if (t[x] === '#') break;
      var ce = commentIdx(t, x), seg = t.slice(x, ce).replace(/[ \t]+$/, '');
      if ((keyAt(j, x) || /:([ \t]|$)/.test(seg)) && /^[^\s:'"]+:[^\s]/.test(text)) fail('Missing space after ":" on line ' + (line0 + 1) + ': "' + text + '" is read as one string, not as "key: value". Add a space after the colon', line0, col + text.indexOf(':') + 1);
      if (keyAt(j, x) || /:([ \t]|$)/.test(seg)) fail('Mapping values are not allowed here. This line looks like "key: value" but it is indented under the plain value on line ' + (line0 + 1) + '. Fix the indentation, or end line ' + (line0 + 1) + ' with ":" if this should be a nested mapping', j, x);
      out += pend ? '\n'.repeat(pend) : ' ';
      out += seg; pend = 0; multi = true; j++; li = j;
      if (ce < t.length) break;
    }
    return multi ? out : yResolve(out, warnAt(line0));
  }

  function applyTag(tag, v, l, c) {
    if (tag === '!!str') return v === null ? '' : typeof v === 'object' ? v : String(v);
    if (tag === '!!int' || tag === '!!float') { var n = Number(v); if (typeof v === 'object' || isNaN(n)) fail('Value cannot be converted to ' + tag, l, c); return n; }
    if (tag === '!!bool') { if (typeof v !== 'boolean') fail('Value is not a boolean (true/false)', l, c); return v; }
    if (tag === '!!null') return null;
    return v;
  }

  function parseValue(col, pInd, isMapVal) {
    var s = L[li], anchor = null, tag = null, l0 = li, c0;
    while (s[col] === ' ' || s[col] === '\t') col++;
    for (;;) {
      if (s[col] === '&') {
        var am = /^&([^\s,\[\]{}]+)/.exec(s.slice(col));
        if (!am) fail('Anchor name missing after "&"', li, col);
        anchor = am[1]; col += am[0].length;
      } else if (s[col] === '!') {
        var tm = /^!\S*/.exec(s.slice(col)); tag = tm[0]; col += tm[0].length;
      } else break;
      if (col < s.length && s[col] !== ' ' && s[col] !== '\t') fail('Expected a space after the anchor or tag', li, col);
      while (s[col] === ' ' || s[col] === '\t') col++;
    }
    c0 = col;
    var v, rest = s.slice(col), c = rest[0];
    if (rest === '' || c === '#') {
      li++; skipBlank();
      if (atEnd()) v = null;
      else {
        checkTab(li);
        var m = ind(L[li]);
        if (m > pInd) v = parseBlockAt(m, pInd);
        else if (isMapVal && m === pInd && isDash(L[li], m)) v = parseSeq(m, true);
        else v = null;
      }
    } else if (c === '*') {
      var a = /^\*([^\s,\[\]{}]+)/.exec(rest);
      if (!a || !hasOwn(anchors, a[1])) fail('Unknown alias "' + (a ? a[0] : '*') + '": no anchor "&' + (a ? a[1] : '') + '" is defined above this line', li, col);
      if (!restOk(s, col + a[0].length)) fail('Unexpected text after the alias', li, col + a[0].length);
      v = anchors[a[1]]; li++;
    } else if (c === '|' || c === '>') v = blockScalar(col, pInd);
    else if (c === '"' || c === "'") {
      var r = quotedAt(li, col);
      if (!restOk(L[r.line], r.col)) fail('Unexpected text after the closing quote. If the value itself contains ' + c + ' characters, wrap it in the other kind of quotes or escape them' + (c === "'" ? " ('' inside single quotes)" : ' (\\" inside double quotes)'), r.line, r.col);
      v = r.value; li = r.line + 1;
    } else if (c === '[' || c === '{') {
      var f = flowAt(li, col);
      if (f.line < L.length && !restOk(L[f.line], f.col)) fail('Unexpected text after the end of the flow collection (check your brackets and commas)', f.line, f.col);
      v = f.value; li = f.line + 1;
    } else if (isDash(s, col)) fail('A sequence item "- " cannot start on the same line as a mapping key. Put the list on the next line, indented under the key', li, col);
    else if (c === '@' || c === '`') fail('A plain value cannot start with "' + c + '" (reserved character). Put the value in quotes', li, col);
    else if (c === '%' && pInd < 0) fail('Unexpected directive. Directives (%YAML, %TAG) must come before "---"', li, col);
    else v = plain(col, pInd);
    if (tag) v = applyTag(tag, v, l0, c0);
    if (anchor) anchors[anchor] = v;
    return v;
  }

  function parseBlockAt(n, pInd) {
    var s = L[li];
    if (isDash(s, n)) return parseSeq(n);
    if (keyAt(li, n)) return parseMap(n);
    return parseValue(n, pInd, false);
  }

  function parseSeq(n, indentless) {
    var arr = [];
    for (;;) {
      skipBlank(); if (atEnd()) break;
      checkTab(li);
      var s = L[li], m = ind(s);
      if (m < n) break;
      if (m > n) fail('Bad indentation of a sequence item: expected ' + n + ' spaces, found ' + m, li, m);
      if (!isDash(s, m)) {
        if (indentless) break;
        if (keyAt(li, m)) fail('Expected a sequence item "- " but found a mapping key. A list and "key: value" pairs cannot be mixed at the same indentation level', li, m);
        fail('Expected a sequence item starting with "- "', li, m);
      }
      var c = m + 1; while (s[c] === ' ' || s[c] === '\t') c++;
      if (c >= s.length || s[c] === '#') { arr.push(parseValue(c, n, false)); continue; }
      L[li] = s.slice(0, m) + ' ' + s.slice(m + 1).replace(/^\t+/, function (t) { return ' '.repeat(t.length); });
      var s2 = L[li];
      if (isDash(s2, c) || keyAt(li, c)) arr.push(parseBlockAt(c, n));
      else arr.push(parseValue(c, n, false));
    }
    return arr;
  }

  function parseMap(n) {
    var obj = {}, lines = {};
    for (;;) {
      skipBlank(); if (atEnd()) break;
      checkTab(li);
      var s = L[li], m = ind(s);
      if (m < n) break;
      if (m > n) fail('Bad indentation of a mapping entry: expected ' + n + ' spaces (like the keys above), found ' + m, li, m);
      if (isDash(s, m)) fail('Expected a "key: value" mapping entry but found a sequence item "- ". A list and "key: value" pairs cannot be mixed at the same indentation level', li, m);
      var k = keyAt(li, m);
      if (!k) {
        var cm = /:(?=\S)/.exec(s.slice(m, commentIdx(s, m)));
        fail(cm ? 'Expected "key: value" but found no space after ":". In YAML a colon must be followed by a space, otherwise "' + s.slice(m).trim() + '" is a single string' : 'Expected a "key: value" mapping entry (missing ":"?) or this line has the wrong indentation', li, cm ? m + cm.index + 1 : m);
      }
      var kl = li, v = parseValue(k.valCol, n, true);
      if (k.key === '<<' && !k.quoted) {
        var srcs = Array.isArray(v) ? v : [v];
        srcs.forEach(function (src) {
          if (!src || typeof src !== 'object' || Array.isArray(src)) fail('Merge key "<<" needs an alias to a mapping, e.g. <<: *defaults', kl, m);
          Object.keys(src).forEach(function (x) { if (!hasOwn(obj, x)) ySet(obj, x, src[x]); });
        });
        continue;
      }
      if (hasOwn(lines, k.key)) warnings.push({ line: kl + 1, message: 'Duplicate key "' + k.key + '" (first defined on line ' + lines[k.key] + '). Most parsers keep only the last value; some reject the file' });
      lines[k.key] = kl + 1;
      ySet(obj, k.key, v);
    }
    return obj;
  }

  var docs = [];
  for (;;) {
    while (li < L.length && (isBlank(li) || /^%/.test(L[li])) && !isMarker(li)) li++;
    if (li >= L.length) break;
    var explicit = false;
    if (/^---([ \t]|$)/.test(L[li])) { explicit = true; L[li] = '   ' + L[li].slice(3); }
    else if (/^\.\.\.([ \t]|$)/.test(L[li])) { li++; continue; }
    skipBlank();
    var v = null;
    if (!atEnd() || (explicit && li < L.length && !isMarker(li))) {
      if (li < L.length && !isMarker(li)) { checkTab(li); v = parseBlockAt(ind(L[li]), -1); }
    }
    skipBlank();
    if (li < L.length && !isMarker(li)) {
      var n2 = ind(L[li]);
      fail(n2 > 0 ? 'Bad indentation: this line does not line up with any parent block above it' : 'Unexpected content: this line is not part of the structure above (check the indentation of the first lines)', li, n2);
    }
    docs.push(v);
    anchors = {};
    if (li < L.length && /^\.\.\.([ \t]|$)/.test(L[li])) li++;
  }
  return { docs: docs, warnings: warnings };
};

T.yamlCheck = function (text) {
  try { var r = T.yamlParse(text); return { ok: true, docs: r.docs, warnings: r.warnings }; }
  catch (e) { if (!e.yaml) throw e; return { ok: false, message: e.message, line: e.line, col: e.col }; }
};

function yNeedsQuote(s) {
  if (s === '' || s !== s.trim()) return true;
  if (yResolve(s) !== s || Y11_BOOL.test(s) || /^[0-9]+(:[0-5]?[0-9])+$/.test(s) || /^[-+]?0[0-9]+$/.test(s)) return true;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /:([ \t]|$)|[ \t]#/.test(s)) return true;
  if (/^(---|\.\.\.)/.test(s) || /[\x00-\x1f\x7f\x85\u2028\u2029\ufeff]/.test(s)) return true;
  return false;
}
function yStr(s, ind) {
  if (/\n/.test(s) && !/[\x00-\x08\x0b-\x1f\x7f\x85\u2028\u2029\ufeff]/.test(s) && !/^[ \t]/.test(s) && !/[ \t]\n|[ \t]$/.test(s)) {
    var body = s.replace(/\n+$/, ''), trail = s.length - body.length;
    var head = trail === 0 ? '|-' : trail === 1 ? '|' : '|+';
    var lines = (trail > 1 ? s.slice(0, -1) : body).split('\n');
    var pad = ' '.repeat(ind);
    return head + '\n' + lines.map(function (l) { return l ? pad + l : ''; }).join('\n');
  }
  return yNeedsQuote(s) ? JSON.stringify(s) : s;
}
function yScalar(v, ind) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return isNaN(v) ? '.nan' : v === Infinity ? '.inf' : v === -Infinity ? '-.inf' : String(v);
  if (Array.isArray(v)) return '[]';
  if (typeof v === 'object') return '{}';
  return yStr(String(v), ind);
}
function yIsBlock(v) { return v && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0); }
function yIndent(text, pad) { return text.split('\n').map(function (l) { return l ? pad + l : ''; }).join('\n'); }
function yEmit(v, ind) {
  if (!yIsBlock(v)) return yScalar(v, ind);
  if (Array.isArray(v)) {
    return v.map(function (x) {
      var b = yIsBlock(x) ? yEmit(x, ind) : yScalar(x, ind);
      var ls = b.split('\n');
      return '- ' + ls[0] + (ls.length > 1 ? '\n' + yIndent(ls.slice(1).join('\n'), '  ') : '');
    }).join('\n');
  }
  return Object.keys(v).map(function (k) {
    var x = v[k], kk = yNeedsQuote(k) || /\n/.test(k) ? JSON.stringify(k) : k;
    if (yIsBlock(x)) return kk + ':\n' + yIndent(yEmit(x, ind), ' '.repeat(ind));
    return kk + ': ' + yScalar(x, ind);
  }).join('\n');
}
T.yamlStringify = function (v, ind) { return yEmit(v, ind || 2) + '\n'; };

/* ---------------- UUID ---------------- */
function randBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
function hx2(b) { return (b < 16 ? '0' : '') + b.toString(16); }
T.uuidFormat = function (b) {
  var h = ''; for (var i = 0; i < 16; i++) h += hx2(b[i]);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
};
T.uuidV4 = function (rnd) {
  var b = (rnd || randBytes)(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  return T.uuidFormat(b);
};
// Returns a v7 generator that is strictly increasing even within one millisecond (RFC 9562 method 1: 12-bit counter in rand_a).
T.uuidV7Gen = function (rnd) {
  rnd = rnd || randBytes;
  var lastMs = -1, seq = 0;
  return function (now) {
    var ms = Math.floor(now === undefined ? Date.now() : now), b = rnd(16);
    if (ms <= lastMs) {
      ms = lastMs; seq++;
      if (seq > 0xfff) { ms++; seq = ((b[6] & 0x07) << 8) | b[7]; }
    } else seq = ((b[6] & 0x07) << 8) | b[7];
    lastMs = ms;
    var hi = Math.floor(ms / 0x100000000), lo = ms >>> 0;
    b[0] = (hi >>> 8) & 255; b[1] = hi & 255; b[2] = lo >>> 24; b[3] = (lo >>> 16) & 255; b[4] = (lo >>> 8) & 255; b[5] = lo & 255;
    b[6] = 0x70 | (seq >>> 8); b[7] = seq & 255;
    b[8] = (b[8] & 0x3f) | 0x80;
    return T.uuidFormat(b);
  };
};
var UUID_VER = { 1: 'time-based (Gregorian timestamp + node/MAC)', 2: 'DCE Security', 3: 'name-based (MD5)', 4: 'random', 5: 'name-based (SHA-1)', 6: 'time-ordered (reordered v1 timestamp)', 7: 'time-ordered (Unix ms timestamp + random)', 8: 'custom / vendor-specific' };
T.uuidInspect = function (str) {
  var s = String(str).trim().replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1');
  var h = s.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) {
    var bad = s.search(/[^0-9a-fA-F-]/);
    throw new Error(bad >= 0 ? 'Invalid character "' + s[bad] + '" at position ' + (bad + 1) + ': a UUID contains only hex digits 0-9, a-f and hyphens'
      : 'A UUID has 32 hex digits; this has ' + h.length);
  }
  if (s.length !== 32 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Error('Hyphens are in the wrong place: the canonical form is 8-4-4-4-12 hex digits');
  h = h.toLowerCase();
  var canon = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  var r = { canonical: canon, hex: h, version: parseInt(h[12], 16) };
  if (/^0+$/.test(h)) { r.special = 'Nil UUID (all zeros)'; return r; }
  if (/^f+$/.test(h)) { r.special = 'Max UUID (all ones)'; return r; }
  var vn = parseInt(h[16], 16);
  r.variant = vn < 8 ? 'NCS (reserved, backward compatibility)' : vn < 12 ? 'RFC 9562 / RFC 4122 (standard)' : vn < 14 ? 'Microsoft (reserved, legacy GUID)' : 'Reserved for future use';
  r.standard = vn >= 8 && vn < 12;
  r.versionName = r.standard ? (UUID_VER[r.version] || 'unknown version ' + r.version) : 'n/a (not an RFC variant)';
  if (r.standard && (r.version === 1 || r.version === 6)) {
    var t100 = r.version === 1 ? parseInt(h.slice(13, 16), 16) * 281474976710656 + parseInt(h.slice(8, 12), 16) * 4294967296 + parseInt(h.slice(0, 8), 16)
      : parseInt(h.slice(0, 12), 16) * 4096 + parseInt(h.slice(13, 16), 16);
    r.ms = t100 / 10000 - 12219292800000;
    r.clockSeq = parseInt(h.slice(16, 20), 16) & 0x3fff;
    r.node = h.slice(20).match(/../g).join(':');
    r.multicast = (parseInt(h.slice(20, 22), 16) & 1) === 1;
  }
  if (r.standard && r.version === 7) r.ms = parseInt(h.slice(0, 12), 16);
  return r;
};

/* ---------------- Text diff ---------------- */
T.splitLines = function (t) { var a = String(t).split(/\r\n|\r|\n/); if (a.length > 1 && a[a.length - 1] === '') a.pop(); if (a.length === 1 && a[0] === '' ) return []; return a; };
// Myers O(ND) diff on arrays. Returns ops: {t:'='|'-'|'+', a, b} with line indices ai/bi.
T.diffArrays = function (A, B, eq) {
  eq = eq || function (x, y) { return x === y; };
  var n = A.length, m = B.length, pre = 0, suf = 0;
  while (pre < n && pre < m && eq(A[pre], B[pre])) pre++;
  while (suf < n - pre && suf < m - pre && eq(A[n - 1 - suf], B[m - 1 - suf])) suf++;
  var a0 = pre, a1 = n - suf, b0 = pre, b1 = m - suf, N = a1 - a0, M = b1 - b0, ops = [], k, i;
  for (i = 0; i < pre; i++) ops.push({ t: '=', ai: i, bi: i });
  var mid = [];
  if (N === 0) for (i = b0; i < b1; i++) mid.push({ t: '+', bi: i });
  else if (M === 0) for (i = a0; i < a1; i++) mid.push({ t: '-', ai: i });
  else {
    var MAX = N + M, off = MAX + 1, V = new Int32Array(2 * MAX + 3), trace = [], D, found = false, limit = Math.min(MAX, 3000);
    for (D = 0; D <= limit; D++) {
      trace.push(V.slice(off - D - 1, off + D + 2));
      for (k = -D; k <= D; k += 2) {
        var x = (k === -D || (k !== D && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
        while (x < N && y < M && eq(A[a0 + x], B[b0 + y])) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) {
      for (i = a0; i < a1; i++) mid.push({ t: '-', ai: i });
      for (i = b0; i < b1; i++) mid.push({ t: '+', bi: i });
      ops.tooBig = true;
    } else {
      var x2 = N, y2 = M;
      for (var d = D; d > 0; d--) {
        var Vp = trace[d], vk = function (kk) { return Vp[kk + d + 1]; };
        k = x2 - y2;
        var pk = (k === -d || (k !== d && vk(k - 1) < vk(k + 1))) ? k + 1 : k - 1;
        var px = vk(pk), py = px - pk;
        while (x2 > px && y2 > py) { x2--; y2--; mid.push({ t: '=', ai: a0 + x2, bi: b0 + y2 }); }
        if (pk === k + 1) mid.push({ t: '+', bi: b0 + py });
        else mid.push({ t: '-', ai: a0 + px });
        x2 = px; y2 = py;
      }
      while (x2 > 0 && y2 > 0) { x2--; y2--; mid.push({ t: '=', ai: a0 + x2, bi: b0 + y2 }); }
      mid.reverse();
    }
  }
  for (i = 0; i < mid.length; i++) ops.push(mid[i]);
  for (i = 0; i < suf; i++) ops.push({ t: '=', ai: a1 + i, bi: b1 + i });
  return ops;
};
T.diffLines = function (a, b, opt) {
  opt = opt || {};
  var A = T.splitLines(a), B = T.splitLines(b);
  var norm = function (s) { if (opt.ignoreWs) s = s.replace(/\s+/g, ' ').trim(); if (opt.ignoreCase) s = s.toLowerCase(); return s; };
  var NA = A.map(norm), NB = B.map(norm);
  var ops = T.diffArrays(NA, NB);
  var res = ops.map(function (o) { return { t: o.t, ai: o.ai, bi: o.bi, a: o.ai === undefined ? undefined : A[o.ai], b: o.bi === undefined ? undefined : B[o.bi] }; });
  res.tooBig = ops.tooBig;
  res.added = res.filter(function (o) { return o.t === '+'; }).length;
  res.removed = res.filter(function (o) { return o.t === '-'; }).length;
  res.same = res.length - res.added - res.removed;
  return res;
};
T.diffUnified = function (ops, ctx, nameA, nameB) {
  ctx = ctx === undefined ? 3 : ctx;
  var out = ['--- ' + (nameA || 'original'), '+++ ' + (nameB || 'changed')], i = 0, n = ops.length;
  var changes = []; ops.forEach(function (o, k) { if (o.t !== '=') changes.push(k); });
  if (!changes.length) return '';
  var ci = 0;
  while (ci < changes.length) {
    var start = Math.max(0, changes[ci] - ctx), end = changes[ci];
    while (ci < changes.length && changes[ci] <= end + 2 * ctx) { end = changes[ci]; ci++; }
    end = Math.min(n - 1, end + ctx);
    var lines = [], aStart = null, bStart = null, aLen = 0, bLen = 0, aBefore = 0, bBefore = 0;
    for (i = 0; i < start; i++) { if (ops[i].t !== '+') aBefore++; if (ops[i].t !== '-') bBefore++; }
    for (i = start; i <= end; i++) {
      var o = ops[i];
      if (o.t === '=') { lines.push(' ' + o.a); aLen++; bLen++; }
      else if (o.t === '-') { lines.push('-' + o.a); aLen++; }
      else { lines.push('+' + o.b); bLen++; }
    }
    aStart = aLen ? aBefore + 1 : aBefore; bStart = bLen ? bBefore + 1 : bBefore;
    out.push('@@ -' + aStart + (aLen === 1 ? '' : ',' + aLen) + ' +' + bStart + (bLen === 1 ? '' : ',' + bLen) + ' @@');
    out = out.concat(lines);
  }
  return out.join('\n') + '\n';
};
// Pair up runs of deletions and insertions so a changed line can be shown side by side.
T.diffRows = function (ops) {
  var rows = [], i = 0;
  while (i < ops.length) {
    if (ops[i].t === '=') { rows.push({ t: '=', l: ops[i], r: ops[i] }); i++; continue; }
    var dels = [], adds = [];
    while (i < ops.length && ops[i].t === '-') dels.push(ops[i++]);
    while (i < ops.length && ops[i].t === '+') adds.push(ops[i++]);
    while (i < ops.length && ops[i].t === '-') dels.push(ops[i++]);
    for (var k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ t: dels[k] && adds[k] ? '~' : dels[k] ? '-' : '+', l: dels[k] || null, r: adds[k] || null });
  }
  return rows;
};
// Character-level change within a pair of lines: common prefix and suffix are kept, the middle is highlighted.
T.inlineDiff = function (a, b) {
  var p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  var s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { pre: p, suf: s };
};

/* ---------------- Hashes ---------------- */
var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
var MD5_K = []; for (var mk = 0; mk < 64; mk++) MD5_K[mk] = Math.floor(Math.abs(Math.sin(mk + 1)) * 4294967296) | 0;
T.md5 = function (input) {
  var bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  var n = bytes.length, total = ((n + 8) >>> 6) + 1 << 6, buf = new Uint8Array(total);
  buf.set(bytes); buf[n] = 0x80;
  var bits = n * 8, dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bits >>> 0, true); dv.setUint32(total - 4, Math.floor(bits / 4294967296), true);
  var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476, M = new Int32Array(16);
  for (var off = 0; off < total; off += 64) {
    for (var j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);
    var A = a0, B = b0, C = c0, D = d0;
    for (var i = 0; i < 64; i++) {
      var F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  var out = new Uint8Array(16), ov = new DataView(out.buffer);
  ov.setInt32(0, a0, true); ov.setInt32(4, b0, true); ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
  return out;
};
T.toHex = function (bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += hx2(bytes[i]); return s; };
T.HASHES = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
T.hashAll = function (bytes) {
  var subtle = typeof crypto !== 'undefined' && crypto.subtle;
  return Promise.all(T.HASHES.map(function (alg) {
    if (alg === 'MD5') return Promise.resolve(T.md5(bytes));
    if (!subtle) return Promise.resolve(null);
    return subtle.digest(alg, bytes).then(function (b) { return new Uint8Array(b); });
  })).then(function (list) { var o = {}; T.HASHES.forEach(function (h, k) { o[h] = list[k]; }); return o; });
};
// Pull a checksum out of whatever was pasted: "sha256:abc", "abc  file.iso", "SHA256 (file) = abc", base64...
T.normalizeChecksum = function (s) {
  s = String(s).trim();
  var m = /=\s*([0-9a-fA-F]{32,128})\s*$/.exec(s) || /^([0-9a-fA-F]{32,128})(\s|$)/.exec(s.replace(/^(md5|sha-?1|sha-?256|sha-?384|sha-?512)[:-]/i, '')) || /([0-9a-fA-F]{32,128})/.exec(s);
  if (m) return { hex: m[1].toLowerCase() };
  var b = s.replace(/^(sha(256|384|512)|md5|sha1)-/i, '');
  if (/^[A-Za-z0-9+\/_-]{20,}={0,2}$/.test(b)) { try { return { hex: T.toHex(T.b64decodeBytes(b)) }; } catch (e) {} }
  return { hex: s.toLowerCase().replace(/\s+/g, '') };
};

/* ---------------- Line endings & whitespace ---------------- */
var ZW = { '\u200b': 'ZERO WIDTH SPACE', '\u200c': 'ZERO WIDTH NON-JOINER', '\u200d': 'ZERO WIDTH JOINER', '\u2060': 'WORD JOINER', '\ufeff': 'BYTE ORDER MARK / ZWNBSP', '\u00ad': 'SOFT HYPHEN', '\u200e': 'LEFT-TO-RIGHT MARK', '\u200f': 'RIGHT-TO-LEFT MARK' };
var ODDSP = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;
var SMART = /[\u2018\u2019\u201c\u201d\u2013\u2014]/;
T.wsInspect = function (text) {
  var r = { bom: text.charCodeAt(0) === 0xfeff, crlf: 0, lf: 0, cr: 0, lines: 0, tabIndent: 0, spaceIndent: 0, mixedIndent: 0, trailing: 0, nbsp: 0, zeroWidth: 0, smart: 0, control: 0,
    finalNewline: /(\r\n|\r|\n)$/.test(text), at: { trailing: [], mixedIndent: [], nbsp: [], zeroWidth: [], smart: [], control: [], tabIndent: [], spaceIndent: [] }, chars: {} };
  var body = r.bom ? text.slice(1) : text, re = /\r\n|\r|\n/g, m, start = 0, ln = 0;
  function note(k, line, col) { r[k]++; if (r.at[k].length < 50) r.at[k].push(line + ':' + col); }
  function scan(line, s) {
    var ind = /^[ \t]*/.exec(s)[0];
    if (s.length > ind.length || ind.length) {
      if (/\t/.test(ind) && / /.test(ind)) note('mixedIndent', line, 1);
      else if (ind[0] === '\t') note('tabIndent', line, 1);
      else if (ind[0] === ' ' && s.length > ind.length) note('spaceIndent', line, 1);
    }
    var tw = /[ \t\u00a0]+$/.exec(s); if (tw) note('trailing', line, tw.index + 1);
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\u00a0' || (ODDSP.test(c) && c !== '\u00a0')) { note('nbsp', line, i + 1); r.chars[c] = (r.chars[c] || 0) + 1; }
      else if (ZW[c]) { note('zeroWidth', line, i + 1); r.chars[c] = (r.chars[c] || 0) + 1; }
      else if (SMART.test(c)) note('smart', line, i + 1);
      else if (c < ' ' && c !== '\t' || c === '\x7f') note('control', line, i + 1);
    }
  }
  while ((m = re.exec(body))) {
    ln++; scan(ln, body.slice(start, m.index));
    if (m[0] === '\r\n') r.crlf++; else if (m[0] === '\n') r.lf++; else r.cr++;
    start = m.index + m[0].length;
  }
  if (start < body.length || !ln) { ln++; scan(ln, body.slice(start)); }
  r.lines = ln;
  var kinds = (r.crlf ? 1 : 0) + (r.lf ? 1 : 0) + (r.cr ? 1 : 0);
  r.eol = kinds === 0 ? 'none' : kinds > 1 ? 'mixed' : r.crlf ? 'CRLF (Windows)' : r.lf ? 'LF (Unix, macOS)' : 'CR (classic Mac)';
  return r;
};
T.wsNormalize = function (text, o) {
  o = o || {};
  var s = String(text);
  if (o.stripBom !== false) s = s.replace(/^\ufeff/, '');
  if (o.zeroWidth) s = s.replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u200e\u200f]/g, '');
  if (o.nbsp) s = s.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ');
  if (o.smart) s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-');
  var lines = s.split(/\r\n|\r|\n/);
  var tab = +o.tabs || 0;
  lines = lines.map(function (l) {
    if (tab) l = l.replace(/^[ \t]+/, function (ind) { var col = 0, out = ''; for (var i = 0; i < ind.length; i++) { if (ind[i] === '\t') { var n = tab - (col % tab); out += ' '.repeat(n); col += n; } else { out += ' '; col++; } } return out; });
    if (o.trailing) l = l.replace(/[ \t\u00a0]+$/, '');
    return l;
  });
  if (o.finalNewline) { while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); lines.push(''); }
  return lines.join(o.eol === 'crlf' ? '\r\n' : '\n');
};
// Visible rendering: tabs, CR, trailing whitespace and invisible characters are marked.
T.wsVisualize = function (text, maxLines) {
  var lines = text.split(/(\r\n|\r|\n)/), html = '', count = 0;
  for (var k = 0; k < lines.length; k += 2) {
    if (++count > (maxLines || 2000)) { html += '<span class="wsn">… (only the first ' + (maxLines || 2000) + ' lines are shown)</span>\n'; break; }
    var s = lines[k], eol = lines[k + 1] || '', tw = /[ \t\u00a0]+$/.exec(s), cut = tw ? tw.index : s.length, out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i], trail = i >= cut, cls = trail ? ' tw' : '';
      if (c === '\t') out += '<span class="wst' + cls + '">→\t</span>';
      else if (c === ' ' && trail) out += '<span class="wss tw">·</span>';
      else if (c === '\ufeff' && k === 0 && i === 0) out += '<span class="wsx">BOM</span>';
      else if (ZW[c]) out += '<span class="wsx" title="' + ZW[c] + '">' + (c === '\ufeff' ? 'FEFF' : 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')) + '</span>';
      else if (ODDSP.test(c)) out += '<span class="wsx" title="non-breaking/unusual space">' + (c === '\u00a0' ? 'NBSP' : 'U+' + c.charCodeAt(0).toString(16).toUpperCase()) + '</span>';
      else if (c < ' ' || c === '\x7f') out += '<span class="wsx">^' + String.fromCharCode(c.charCodeAt(0) ^ 64) + '</span>';
      else out += esc(c);
    }
    html += out + (eol === '\r\n' ? '<span class="wse">␍␊</span>' : eol === '\r' ? '<span class="wse wsx">␍</span>' : eol ? '<span class="wse">␊</span>' : '') + '\n';
  }
  return html;
};
T.decodeFileBytes = function (bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { enc: 'UTF-8 with BOM', text: new TextDecoder('utf-8').decode(bytes.subarray(3)), bom: true };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { enc: 'UTF-16 LE (BOM)', text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), bom: true };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { enc: 'UTF-16 BE (BOM)', text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), bom: true };
  var u = T.utf8Decode(bytes);
  return { enc: u.ok ? 'UTF-8' : 'not valid UTF-8 (probably Windows-1252/Latin-1 or binary)', text: u.ok ? u.text : new TextDecoder('windows-1252').decode(bytes), bom: false, invalid: !u.ok };
};

/* ---------------- SQL formatter ---------------- */
var SQL_KW = ('SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE BETWEEN EXISTS AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS NATURAL USING GROUP BY ORDER ' +
  'HAVING LIMIT OFFSET UNION ALL DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES DEFAULT ' +
  'CONSTRAINT CHECK DROP ALTER ADD COLUMN RENAME TO IF REPLACE CASE WHEN THEN ELSE END ASC DESC WITH RECURSIVE RETURNING CONFLICT DO NOTHING DUPLICATE ' +
  'INTERSECT EXCEPT MINUS OVER PARTITION WINDOW ROWS RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT ROW FETCH FIRST NEXT ONLY TRUE FALSE AUTO_INCREMENT ' +
  'AUTOINCREMENT CASCADE RESTRICT TRUNCATE TEMPORARY TEMP LATERAL APPLY FOR SHARE NULLS LAST BEGIN COMMIT ROLLBACK TRANSACTION GRANT REVOKE IGNORE ANY ' +
  'SOME INTERVAL COLLATE ESCAPE SIMILAR REGEXP RLIKE QUALIFY ENGINE CHARSET CHARACTER TOP MATERIALIZED SCHEMA DATABASE TRIGGER PROCEDURE FUNCTION RETURNS ' +
  'LANGUAGE FILTER WITHIN EXPLAIN ANALYZE SHOW DESCRIBE USE OF NO ACTION MODIFY CHANGE FIRST AFTER').split(' ');
var SQL_FN = ('COUNT SUM AVG MIN MAX COALESCE NULLIF IFNULL ISNULL NVL CAST CONVERT CONCAT CONCAT_WS SUBSTRING SUBSTR LOWER UPPER TRIM LTRIM RTRIM LENGTH ' +
  'CHAR_LENGTH ROUND FLOOR CEIL CEILING ABS NOW DATE_TRUNC DATE_FORMAT DATE_ADD DATE_SUB DATEADD DATEDIFF EXTRACT TO_CHAR TO_DATE TO_TIMESTAMP STRING_AGG ' +
  'GROUP_CONCAT ARRAY_AGG JSON_AGG JSONB_AGG JSON_EXTRACT JSON_OBJECT JSON_BUILD_OBJECT ROW_NUMBER RANK DENSE_RANK NTILE LAG LEAD FIRST_VALUE LAST_VALUE ' +
  'GREATEST LEAST POSITION REPLACE IIF UNNEST GENERATE_SERIES ' +
  'INT INTEGER BIGINT SMALLINT TINYINT MEDIUMINT DECIMAL NUMERIC FLOAT DOUBLE REAL VARCHAR NVARCHAR CHAR NCHAR TEXT BOOLEAN BOOL DATE TIME TIMESTAMP ' +
  'TIMESTAMPTZ DATETIME SERIAL BIGSERIAL UUID JSON JSONB BLOB BYTEA VARBINARY BINARY ENUM').split(' ');
var SQL_KWS = {}, SQL_FNS = {};
SQL_KW.forEach(function (k) { SQL_KWS[k] = 1; }); SQL_FN.forEach(function (k) { SQL_FNS[k] = 1; });
var SQL_PHRASES = ['CREATE OR REPLACE VIEW', 'CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE', 'CREATE UNIQUE INDEX', 'CREATE MATERIALIZED VIEW',
  'DROP TABLE IF EXISTS', 'ON DUPLICATE KEY UPDATE', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'INSERT IGNORE INTO', 'DO UPDATE SET',
  'GROUP BY', 'ORDER BY', 'PARTITION BY', 'UNION ALL', 'UNION DISTINCT', 'INSERT INTO', 'REPLACE INTO', 'DELETE FROM', 'LEFT JOIN', 'RIGHT JOIN',
  'FULL JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN', 'CROSS APPLY', 'OUTER APPLY', 'ON CONFLICT', 'CREATE TABLE', 'CREATE VIEW', 'CREATE INDEX',
  'ALTER TABLE', 'DROP TABLE', 'DROP VIEW', 'DROP INDEX', 'TRUNCATE TABLE', 'PRIMARY KEY', 'FOREIGN KEY', 'NOT NULL', 'IS NOT', 'NOT IN', 'NOT LIKE',
  'NOT EXISTS', 'NOT BETWEEN', 'ON DELETE', 'ON UPDATE', 'WITH RECURSIVE', 'SELECT DISTINCT', 'DO NOTHING', 'FETCH FIRST', 'FETCH NEXT', 'FOR UPDATE', 'FOR SHARE', 'UNION'
].map(function (p) { return p.split(' '); }).sort(function (a, b) { return b.length - a.length; });
var SQL_CLAUSE_BLOCK = { 'SELECT': 1, 'SELECT DISTINCT': 1, 'FROM': 1, 'WHERE': 1, 'GROUP BY': 1, 'ORDER BY': 1, 'HAVING': 1, 'SET': 1, 'VALUES': 1,
  'RETURNING': 1, 'WITH': 1, 'WITH RECURSIVE': 1, 'WINDOW': 1, 'ON DUPLICATE KEY UPDATE': 1, 'DO UPDATE SET': 1, 'QUALIFY': 1 };
var SQL_CLAUSE_INLINE = { 'LIMIT': 1, 'OFFSET': 1, 'INSERT INTO': 1, 'INSERT IGNORE INTO': 1, 'REPLACE INTO': 1, 'UPDATE': 1, 'DELETE FROM': 1, 'DELETE': 1,
  'CREATE TABLE': 1, 'CREATE TABLE IF NOT EXISTS': 1, 'CREATE TEMPORARY TABLE': 1, 'CREATE VIEW': 1, 'CREATE OR REPLACE VIEW': 1, 'CREATE MATERIALIZED VIEW': 1,
  'CREATE INDEX': 1, 'CREATE UNIQUE INDEX': 1, 'ALTER TABLE': 1, 'DROP TABLE': 1, 'DROP TABLE IF EXISTS': 1, 'DROP VIEW': 1, 'DROP INDEX': 1,
  'TRUNCATE TABLE': 1, 'ON CONFLICT': 1, 'FETCH FIRST': 1, 'FETCH NEXT': 1, 'FOR UPDATE': 1, 'FOR SHARE': 1, 'DO NOTHING': 1 };
var SQL_SETOP = { 'UNION': 1, 'UNION ALL': 1, 'UNION DISTINCT': 1, 'INTERSECT': 1, 'EXCEPT': 1, 'MINUS': 1 };
var SQL_COMMA_BREAK = { 'SELECT': 1, 'SELECT DISTINCT': 1, 'GROUP BY': 1, 'ORDER BY': 1, 'SET': 1, 'VALUES': 1, 'RETURNING': 1, 'WITH': 1,
  'WITH RECURSIVE': 1, '(columns)': 1, 'ON DUPLICATE KEY UPDATE': 1, 'DO UPDATE SET': 1, 'FROM': 1, 'WINDOW': 1 };

T.sqlTokenize = function (s) {
  var toks = [], i = 0, n = s.length, m;
  function push(type, v) { toks.push({ t: type, v: v }); }
  while (i < n) {
    var c = s[i], rest;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && s[i + 1] === '-' || c === '#' && /^#(\s|$)/.test(s.substr(i, 2))) { var e = s.indexOf('\n', i); if (e < 0) e = n; push('lc', s.slice(i, e).replace(/\s+$/, '')); i = e; continue; }
    if (c === '/' && s[i + 1] === '*') { var e2 = s.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; push('bc', s.slice(i, e2)); i = e2; continue; }
    if (c === "'" || ((c === 'N' || c === 'n' || c === 'E' || c === 'e' || c === 'X' || c === 'x' || c === 'B' || c === 'b') && s[i + 1] === "'" && !/[\w$]/.test(s[i - 1] || ''))) {
      var j = c === "'" ? i + 1 : i + 2;
      while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } j++; break; } j++; }
      if (j > n) j = n;
      push('str', s.slice(i, j)); i = j; continue;
    }
    if (c === '$' && (m = /^\$([A-Za-z_]\w*)?\$/.exec(s.slice(i)))) {
      var end = s.indexOf(m[0], i + m[0].length); end = end < 0 ? n : end + m[0].length;
      push('str', s.slice(i, end)); i = end; continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      var close = c === '[' ? ']' : c, k = i + 1;
      while (k < n) { if (s[k] === close) { if (s[k + 1] === close && c !== '[') { k += 2; continue; } k++; break; } k++; }
      push('id', s.slice(i, k)); i = k; continue;
    }
    rest = s.slice(i, i + 64);
    if ((m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest)) && !/[A-Za-z_]/.test(s[i + m[0].length] || '')) { push('num', m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_\u00c0-\uffff][\w$\u00c0-\uffff]*/.exec(rest))) { push('word', m[0]); i += m[0].length; continue; }
    if ((m = /^([@:]{1,2}[A-Za-z_][\w.]*|\$\d+|\?)/.exec(rest)) && !(c === ':' && s[i + 1] === ':' && toks.length && /^(word|id|str|num|close)$/.test(toks[toks.length - 1].t) && false)) {
      if (!(c === ':' && s[i + 1] === ':')) { push('word', m[0]); i += m[0].length; continue; }
    }
    if ((m = /^(::|->>|->|<=>|<>|<=|>=|!=|\|\||&&|<<|>>|[-+*\/%=<>!~^&|])/.exec(rest))) { push('op', m[0]); i += m[0].length; continue; }
    if (c === '(') { push('open', c); i++; continue; }
    if (c === ')') { push('close', c); i++; continue; }
    if (c === ',') { push('comma', c); i++; continue; }
    if (c === ';') { push('semi', c); i++; continue; }
    if (c === '.') { push('dot', c); i++; continue; }
    push('op', c); i++;
  }
  // merge multi-word keyword phrases
  var out = [];
  for (var a = 0; a < toks.length; a++) {
    var tk = toks[a];
    if (tk.t === 'word') {
      var U = tk.v.toUpperCase(), hit = null;
      for (var p = 0; p < SQL_PHRASES.length && !hit; p++) {
        var ph = SQL_PHRASES[p];
        if (ph[0] !== U || ph.length < 2) continue;
        var ok = true;
        for (var q = 1; q < ph.length; q++) { var nt = toks[a + q]; if (!nt || nt.t !== 'word' || nt.v.toUpperCase() !== ph[q]) { ok = false; break; } }
        if (ok) hit = ph;
      }
      if (hit) {
        out.push({ t: 'kw', v: toks.slice(a, a + hit.length).map(function (x) { return x.v; }).join(' '), u: hit.join(' ') });
        a += hit.length - 1; continue;
      }
      if (SQL_KWS[U] && toks[a - 1] && toks[a - 1].t === 'dot') { out.push(tk); continue; }
      if (SQL_KWS[U] && !(SQL_FNS[U] && toks[a + 1] && toks[a + 1].t === 'open')) { out.push({ t: 'kw', v: tk.v, u: U }); continue; }
      if (SQL_FNS[U]) { out.push({ t: 'fn', v: tk.v, u: U }); continue; }
    }
    out.push(tk);
  }
  return out;
};

function sqlCase(tk, mode) {
  if (tk.t !== 'kw' && tk.t !== 'fn') return tk.v;
  return mode === 'upper' ? tk.u : mode === 'lower' ? tk.u.toLowerCase() : tk.v;
}

T.sqlMinify = function (sql, opts) {
  opts = opts || {};
  var toks = T.sqlTokenize(sql).filter(function (t) { return t.t !== 'lc' && t.t !== 'bc'; }), out = '', prev = null;
  toks.forEach(function (tk) {
    var v = sqlCase(tk, opts.keywordCase || 'preserve');
    if (prev) {
      var tight = /^(open|close|comma|semi|dot)$/.test(tk.t) || /^(open|comma|semi|dot)$/.test(prev.t) || (tk.t === 'op' && prev.t !== 'op') || (prev.t === 'op' && tk.t !== 'op');
      if (tk.t === 'open' && prev.t === 'kw') tight = false;
      if (prev.t === 'close' && /^(kw|word|fn|num|str|id)$/.test(tk.t)) tight = false;
      if (prev.t === 'semi') tight = false;
      if (!tight) out += ' ';
    }
    out += v; prev = tk;
  });
  return out;
};

T.sqlFormat = function (sql, opts) {
  opts = opts || {};
  var unit = opts.indent === 'tab' ? '\t' : ' '.repeat(opts.indent === undefined ? 2 : +opts.indent);
  var mode = opts.keywordCase || 'upper';
  var toks = T.sqlTokenize(sql);
  var lines = [], cur = '', curInd = 0, lineInd = 0, level = 0, clause = null, stack = [], between = false, prev = null, forceNL = false;
  function nl(ind) { if (cur.trim()) lines.push(cur.replace(/\s+$/, '')); cur = unit.repeat(Math.max(0, ind)); curInd = lineInd = Math.max(0, ind); prev = null; forceNL = false; }
  function top() { return stack[stack.length - 1]; }
  function atClause() { var t = top(); return !t || t.type === 'block'; }
  function inlineDepth() { var d = 0; for (var k = stack.length - 1; k >= 0 && stack[k].type !== 'block'; k--) if (stack[k].type === 'inline') d++; return d; }
  function write(tk, v) {
    if (forceNL) nl(curInd);
    var sp = true;
    if (!prev) sp = false;
    else if (/^(comma|semi|close|dot)$/.test(tk.t)) sp = false;
    else if (prev.t === 'open' || prev.t === 'dot') sp = false;
    else if (tk.t === 'op' && tk.v === '::' || prev.t === 'op' && prev.v === '::') sp = false;
    else if (prev.unary) sp = false;
    else if (tk.t === 'open' && (prev.t === 'fn' || prev.t === 'word' || prev.t === 'id') && !(prev.t !== 'fn' && /^(INSERT|REPLACE|CREATE|INTO)/.test(clause || '') && !inlineDepth())) sp = false;
    cur += (sp ? ' ' : '') + v;
    prev = tk;
  }
  for (var i = 0; i < toks.length; i++) {
    var tk = toks[i], v = sqlCase(tk, mode), U = tk.u || '', nx = toks[i + 1];
    if (tk.t === 'lc') { if (prev) cur += ' ' + v; else cur += v; prev = tk; forceNL = true; continue; }
    if (tk.t === 'semi') {
      write(tk, ';'); stack = []; level = 0; clause = null; between = false;
      if (i < toks.length - 1) { nl(0); lines.push(''); }
      continue;
    }
    if (tk.t === 'kw' && atClause()) {
      if (SQL_CLAUSE_BLOCK[U]) { nl(level); write(tk, v); nl(level + 1); clause = U; between = false; continue; }
      if (SQL_CLAUSE_INLINE[U]) { nl(level); write(tk, v); curInd = level + 1; clause = U; continue; }
      if (SQL_SETOP[U]) { nl(level); write(tk, v); nl(level); clause = null; continue; }
      if (/JOIN$|APPLY$/.test(U)) { nl(level + 1); write(tk, v); curInd = level + 2; continue; }
      if ((U === 'AND' || U === 'OR') && !between && clause && /^(WHERE|HAVING|FROM|QUALIFY|ON CONFLICT|DELETE FROM|UPDATE)$/.test(clause)) {
        nl(clause === 'FROM' ? level + 2 : level + 1); write(tk, v); continue;
      }
    }
    if (tk.t === 'kw' && (U === 'BETWEEN' || U === 'NOT BETWEEN')) { between = true; write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'AND' && between) { between = false; write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'CASE') { write(tk, v); stack.push({ type: 'case', base: lineInd }); continue; }
    if (tk.t === 'kw' && (U === 'WHEN' || U === 'ELSE') && top() && top().type === 'case') { nl(top().base + 1); write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'END' && top() && top().type === 'case') { var cs = stack.pop(); nl(cs.base); write(tk, v); continue; }
    if (tk.t === 'open') {
      var la = nx, isSub = la && la.t === 'kw' && /^(SELECT|SELECT DISTINCT|WITH|WITH RECURSIVE|VALUES)$/.test(la.u) && !(la.u === 'VALUES' && true);
      var isCols = !isSub && atClause() && clause && /^CREATE (TEMPORARY )?TABLE/.test(clause) && !stack.some(function (s) { return s.type === 'inline'; }) && prev && prev.t !== 'fn';
      if (isSub || isCols) {
        write(tk, '(');
        stack.push({ type: 'block', level: level, clause: clause, ind: lineInd });
        level = lineInd + 1; clause = isCols ? '(columns)' : null; nl(level);
        continue;
      }
      write(tk, '('); stack.push({ type: 'inline' }); continue;
    }
    if (tk.t === 'close') {
      while (top() && top().type === 'case') stack.pop();
      var o = stack.pop();
      if (o && o.type === 'block') { nl(o.ind); write(tk, ')'); level = o.level; clause = o.clause; curInd = o.ind; continue; }
      write(tk, ')'); continue;
    }
    if (tk.t === 'comma') {
      write(tk, ',');
      if (atClause() && clause && SQL_COMMA_BREAK[clause]) nl(clause === '(columns)' ? level : level + 1);
      continue;
    }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+') && (!prev || /^(op|open|comma|kw)$/.test(prev.t)) && !(prev && prev.t === 'kw' && /^(END|NULL|TRUE|FALSE)$/.test(prev.u))) {
      write(tk, v); prev = { t: 'op', v: tk.v, unary: true }; continue;
    }
    write(tk, v);
  }
  nl(0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
/* ---------------- Shell words (shared by cURL and docker run converters) ---------------- */
// Splits a POSIX shell command line into words. Handles '...', "...", $'...', backslash escapes and
// line continuations (\ , ^ and ` at end of line). Operators (&&, ||, ;, |, newline) become {op: '...'}.
T.shellSplit = function (s) {
  s = String(s).replace(/\r\n?/g, '\n').replace(/[ \t]*(\\|\^|`)\n/g, ' ');
  var out = [], i = 0, n = s.length, w = null;
  function add(ch) { w = (w === null ? '' : w) + ch; }
  function end() { if (w !== null) { out.push(w); w = null; } }
  while (i < n) {
    var c = s[i];
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (c === '\n' || c === ';' || c === '&' && s[i + 1] === '&' || c === '|') {
      end();
      var op = c === '\n' ? '\n' : c === ';' ? ';' : (s[i + 1] === c ? c + c : c);
      out.push({ op: op }); i += op.length === 2 ? 2 : 1; continue;
    }
    if (c === '#' && w === null) { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '\\') { if (i + 1 < n) add(s[i + 1]); i += 2; continue; }
    if (c === "'") { var e = s.indexOf("'", i + 1); if (e < 0) e = n; add(s.slice(i + 1, e)); i = e + 1; continue; }
    if (c === '$' && s[i + 1] === "'") {
      i += 2; var buf = '';
      while (i < n && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < n) {
          var x = s[i + 1], m;
          var map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
          if (map[x] !== undefined) { buf += map[x]; i += 2; }
          else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(i + 1)))) { buf += String.fromCharCode(parseInt(m[1], 16)); i += 1 + m[0].length; }
          else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(s.slice(i + 1))) || (m = /^U([0-9a-fA-F]{1,8})/.exec(s.slice(i + 1)))) { buf += String.fromCodePoint(parseInt(m[1], 16)); i += 1 + m[0].length; }
          else if ((m = /^[0-7]{1,3}/.exec(s.slice(i + 1)))) { buf += String.fromCharCode(parseInt(m[0], 8)); i += 1 + m[0].length; }
          else { buf += '\\' + x; i += 2; }
        } else buf += s[i++];
      }
      // $'...' strings may contain UTF-8 bytes written as \xHH: decode them
      if (/[\x80-\xff]/.test(buf) && !/[^\x00-\xff]/.test(buf)) { try { buf = decodeURIComponent(escape(buf)); } catch (er) { /* keep */ } }
      add(buf); i++; continue;
    }
    if (c === '"') {
      i++; var b2 = '';
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n && '$`"\\\n'.indexOf(s[i + 1]) >= 0) { if (s[i + 1] !== '\n') b2 += s[i + 1]; i += 2; }
        else b2 += s[i++];
      }
      add(b2); i++; continue;
    }
    add(c); i++;
  }
  end();
  return out;
};

/* ---------------- cURL to code ---------------- */
var CURL_VAL = { '-X': 'request', '--request': 'request', '-H': 'header', '--header': 'header', '-d': 'data', '--data': 'data', '--data-ascii': 'data',
  '--data-raw': 'data-raw', '--data-binary': 'data-binary', '--data-urlencode': 'data-urlencode', '--json': 'json', '-u': 'user', '--user': 'user',
  '-F': 'form', '--form': 'form', '--form-string': 'form-string', '-b': 'cookie', '--cookie': 'cookie', '-A': 'user-agent', '--user-agent': 'user-agent',
  '-e': 'referer', '--referer': 'referer', '--url': 'url', '-m': 'max-time', '--max-time': 'max-time', '--connect-timeout': 'connect-timeout',
  '-x': 'proxy', '--proxy': 'proxy', '-o': 'output', '--output': 'output', '-w': 'write-out', '--write-out': 'write-out', '-c': 'cookie-jar',
  '--cookie-jar': 'cookie-jar', '--retry': 'retry', '--cacert': 'cacert', '-E': 'cert', '--cert': 'cert', '--key': 'key', '-T': 'upload-file',
  '--upload-file': 'upload-file', '--oauth2-bearer': 'bearer', '-r': 'range', '--range': 'range', '--resolve': 'resolve', '--max-redirs': 'max-redirs',
  '-K': 'config', '--config': 'config', '--aws-sigv4': 'aws', '--proxy-user': 'proxy-user', '-U': 'proxy-user', '--interface': 'interface',
  '--limit-rate': 'limit-rate', '--retry-delay': 'retry-delay', '--retry-max-time': 'retry-max-time', '-D': 'dump-header', '--dump-header': 'dump-header',
  '--trace': 'trace', '--trace-ascii': 'trace', '--stderr': 'stderr', '-Y': 'skip', '-y': 'skip', '-z': 'skip', '--expect100-timeout': 'skip' };
var CURL_BOOL = { '-L': 'location', '--location': 'location', '-k': 'insecure', '--insecure': 'insecure', '--compressed': 'compressed', '-G': 'get', '--get': 'get',
  '-I': 'head', '--head': 'head', '-s': 1, '--silent': 1, '-S': 1, '--show-error': 1, '-v': 1, '--verbose': 1, '-i': 1, '--include': 1, '-f': 'fail',
  '--fail': 'fail', '--fail-with-body': 'fail', '-O': 'remote-name', '--remote-name': 'remote-name', '-#': 1, '--progress-bar': 1, '-N': 1, '--no-buffer': 1,
  '--http1.1': 1, '--http2': 1, '--http1.0': 1, '--http2-prior-knowledge': 1, '--http3': 1, '-4': 1, '-6': 1, '--ipv4': 1, '--ipv6': 1, '-n': 1, '--netrc': 1,
  '--location-trusted': 'location', '-g': 1, '--globoff': 1, '-q': 1, '--disable': 1, '--no-progress-meter': 1, '--digest': 'digest', '--basic': 1,
  '--ntlm': 'ntlm', '--negotiate': 'ntlm', '-j': 1, '--junk-session-cookies': 1, '--tlsv1.2': 1, '--tlsv1.3': 1, '--path-as-is': 1, '-Z': 1, '--parallel': 1 };

function curlUrlencode(s) { return encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
function hdrFind(h, name) { name = name.toLowerCase(); for (var k = 0; k < h.length; k++) if (h[k][0].toLowerCase() === name) return k; return -1; }

T.curlParse = function (text) {
  var words = T.shellSplit(String(text).trim().replace(/^\$\s+/, '')), r = { method: null, url: null, headers: [], data: [], form: [], auth: null, warnings: [],
    insecure: false, follow: false, compressed: false, get: false, head: false, timeout: null, proxy: null, files: [], digest: false };
  var k = 0;
  while (k < words.length && (typeof words[k] !== 'string' || !/(^|\/)curl(\.exe)?$/i.test(words[k]))) k++;
  if (k >= words.length) { if (typeof words[0] === 'string' && /^(https?|ftp):\/\//i.test(words[0])) k = -1; else throw new Error('No curl command found: paste a command that starts with "curl".'); }
  var rest = [];
  for (k = k + 1; k < words.length; k++) {
    if (typeof words[k] !== 'string') {
      if (words[k].op === '\n' && rest.length && !words.slice(k + 1).some(function (x) { return typeof x === 'string'; })) break;
      if (words[k].op === '\n') { r.warnings.push('The command spans several lines without a trailing "\\": only the first line was used.'); break; }
      r.warnings.push('Ignored everything after "' + words[k].op + '" (only the curl command itself is converted).'); break;
    }
    rest.push(words[k]);
  }
  var endOpts = false;
  for (var i = 0; i < rest.length; i++) {
    var a = rest[i], opt = null, val = null;
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && /^--[a-z0-9]/i.test(a)) {
      var eq = null;
      if (CURL_VAL[a]) opt = a;
      else if (CURL_BOOL[a]) opt = a;
      else if (/^--no-/.test(a)) { if (a === '--no-location') r.follow = false; continue; }
      else { r.warnings.push('Unknown option ' + a + ' was ignored.'); continue; }
      if (CURL_VAL[opt]) { val = rest[++i]; if (val === undefined) throw new Error('Option ' + opt + ' needs a value.'); }
    } else if (!endOpts && /^-[^-]/.test(a) && a.length > 1) {
      // short options may be combined (-sSL) and values may be attached (-XPOST, -HAccept:x)
      for (var j = 1; j < a.length; j++) {
        var f = '-' + a[j];
        if (CURL_VAL[f]) { val = a.slice(j + 1) || rest[++i]; if (val === undefined) throw new Error('Option ' + f + ' needs a value.'); opt = f; break; }
        if (CURL_BOOL[f]) { if (j < a.length - 1) applyCurl(r, f, null); else opt = f; continue; }
        r.warnings.push('Unknown option ' + f + ' was ignored.');
      }
      if (!opt) continue;
    } else {
      if (!r.url) r.url = a; else r.warnings.push('Extra URL "' + a + '" ignored (only the first URL is converted).');
      continue;
    }
    applyCurl(r, opt, val);
  }
  if (!r.url) throw new Error('No URL found in the curl command.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(r.url)) r.url = 'http://' + r.url;
  // body
  var body = null;
  if (r.data.length) body = r.data.join('&');
  if (r.get && body !== null) { r.url += (r.url.indexOf('?') >= 0 ? '&' : '?') + body; body = null; }
  r.body = body;
  if (!r.method) r.method = r.head ? 'HEAD' : (r.get ? 'GET' : (body !== null || r.form.length || r.uploadFile ? (r.uploadFile && !r.data.length ? 'PUT' : 'POST') : 'GET'));
  r.method = r.method.toUpperCase();
  var ct = hdrFind(r.headers, 'content-type');
  if (body !== null && !r.form.length && ct < 0) { r.headers.push(['Content-Type', 'application/x-www-form-urlencoded']); r.implicitForm = true; }
  ct = hdrFind(r.headers, 'content-type');
  r.contentType = ct >= 0 ? r.headers[ct][1] : '';
  r.json = undefined;
  if (body !== null && /json/i.test(r.contentType)) { try { r.json = JSON.parse(body); } catch (e) { r.warnings.push('The body is sent as JSON but is not valid JSON: it is passed through as a raw string.'); } }
  r.formPairs = null;
  if (body !== null && /x-www-form-urlencoded/i.test(r.contentType) && !r.dataFile) {
    var pairs = body.split('&').filter(Boolean).map(function (p) { var e = p.indexOf('='); var kk = e < 0 ? p : p.slice(0, e), vv = e < 0 ? '' : p.slice(e + 1);
      try { return [decodeURIComponent(kk.replace(/\+/g, ' ')), decodeURIComponent(vv.replace(/\+/g, ' '))]; } catch (er) { return null; } });
    if (pairs.length && pairs.every(Boolean)) r.formPairs = pairs;
  }
  if (r.form.length && ct >= 0 && /multipart/i.test(r.contentType)) { r.headers.splice(ct, 1); r.warnings.push('Removed the explicit multipart Content-Type header: the HTTP library must generate it with the boundary.'); }
  return r;
};

function applyCurl(r, opt, val) {
  var name = CURL_VAL[opt] || CURL_BOOL[opt], m;
  switch (name) {
    case 'request': r.method = val; break;
    case 'header':
      if (val.charAt(0) === '@') { r.warnings.push('Headers read from file ' + val.slice(1) + ' are not included.'); break; }
      m = /^([^:;]+)(?::\s?(.*)|;)$/.exec(val);
      if (!m) { r.warnings.push('Could not read header "' + val + '".'); break; }
      if (m[2] === '' && val.indexOf(':') >= 0) { var ix = hdrFind(r.headers, m[1].trim()); if (ix >= 0) r.headers.splice(ix, 1); break; } // "X-Foo:" removes a header
      r.headers.push([m[1].trim(), m[2] === undefined ? '' : m[2]]); break;
    case 'data': case 'data-binary':
      if (val.charAt(0) === '@') { r.dataFile = val.slice(1); r.warnings.push('The body is read from the file "' + val.slice(1) + '": the code below sends a placeholder, read the file yourself.'); r.data.push('<contents of ' + val.slice(1) + '>'); break; }
      r.data.push(name === 'data' ? val.replace(/[\r\n]/g, '') && val : val); break;
    case 'data-raw': r.data.push(val); break;
    case 'data-urlencode':
      m = /^([^=@]*)([=@])([\s\S]*)$/.exec(val);
      if (!m) r.data.push(curlUrlencode(val));
      else if (m[2] === '@') { r.dataFile = m[3]; r.warnings.push('--data-urlencode reads ' + m[3] + ' from a file: replace the placeholder.'); r.data.push((m[1] ? m[1] + '=' : '') + curlUrlencode('<contents of ' + m[3] + '>')); }
      else r.data.push((m[1] ? m[1] + '=' : '') + curlUrlencode(m[3]));
      break;
    case 'json':
      r.data.push(val);
      if (hdrFind(r.headers, 'content-type') < 0) r.headers.push(['Content-Type', 'application/json']);
      if (hdrFind(r.headers, 'accept') < 0) r.headers.push(['Accept', 'application/json']);
      break;
    case 'user': m = val.indexOf(':'); r.auth = m < 0 ? [val, ''] : [val.slice(0, m), val.slice(m + 1)]; if (m < 0) r.warnings.push('-u without a password: curl would prompt for it; the code uses an empty password.'); break;
    case 'form': case 'form-string':
      m = /^([^=]+)=([\s\S]*)$/.exec(val);
      if (!m) { r.warnings.push('Could not read form field "' + val + '".'); break; }
      var v = m[2], fld = { name: m[1], value: v };
      if (name === 'form') {
        var parts = v.split(';'), first = parts[0];
        if (first.charAt(0) === '@' || first.charAt(0) === '<') { fld.file = first.slice(1); fld.value = null; if (first.charAt(0) === '<') { fld.file = null; fld.value = '<contents of ' + first.slice(1) + '>'; } }
        else fld.value = first;
        parts.slice(1).forEach(function (p) { var q = /^\s*(type|filename)=(.*)$/.exec(p); if (q) fld[q[1]] = q[2].replace(/^"|"$/g, ''); });
      }
      r.form.push(fld); break;
    case 'cookie':
      if (val.indexOf('=') < 0) { r.warnings.push('-b ' + val + ' reads cookies from a file: not converted.'); break; }
      var ci = hdrFind(r.headers, 'cookie');
      if (ci >= 0) r.headers[ci][1] += '; ' + val; else r.headers.push(['Cookie', val]);
      break;
    case 'user-agent': r.headers.push(['User-Agent', val]); break;
    case 'referer': r.headers.push(['Referer', val.replace(/;auto$/, '')]); break;
    case 'bearer': r.headers.push(['Authorization', 'Bearer ' + val]); break;
    case 'range': r.headers.push(['Range', 'bytes=' + val]); break;
    case 'url': if (!r.url) r.url = val; break;
    case 'max-time': r.timeout = parseFloat(val); break;
    case 'connect-timeout': if (r.timeout === null) r.timeout = parseFloat(val); break;
    case 'proxy': r.proxy = /^[a-z0-9]+:\/\//i.test(val) ? val : 'http://' + val; break;
    case 'location': r.follow = true; break;
    case 'insecure': r.insecure = true; break;
    case 'compressed': r.compressed = true; break;
    case 'get': r.get = true; break;
    case 'head': r.head = true; break;
    case 'digest': r.digest = true; r.warnings.push('--digest authentication is converted as Basic auth: switch to your library\'s digest support.'); break;
    case 'ntlm': r.warnings.push(opt + ' authentication is not converted.'); break;
    case 'upload-file': r.uploadFile = val; r.data.push('<contents of ' + val + '>'); r.dataFile = val; r.warnings.push('-T uploads the file ' + val + ': the code sends a placeholder body, read the file yourself.'); break;
    case 'output': case 'remote-name': r.warnings.push('Output to a file (' + opt + ') is not converted: write the response body yourself.'); break;
    case 'cacert': case 'cert': case 'key': r.warnings.push(opt + ' ' + val + ' (client/CA certificates) is not converted.'); break;
    case 'aws': r.warnings.push('--aws-sigv4 signing is not converted: use an AWS SDK.'); break;
    case 'config': r.warnings.push('Options read from a config file (' + opt + ') are not included.'); break;
    default: break; // silent / verbose / output formatting options don't change the request
  }
}

/* code generators */
function jstr(s) { return JSON.stringify(s); }
function pystr(s) {
  var q = s.indexOf("'") >= 0 && s.indexOf('"') < 0 ? '"' : "'";
  return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, function (c) { return '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + q;
}
function phpstr(s) { return /[\n\r\t\x00-\x1f]/.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, function (c) { return '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + '"' : "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function pyval(v, ind) {
  ind = ind || '';
  var nx = ind + '    ';
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return pystr(v);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return nx + pyval(x, nx); }).join(',\n') + ',\n' + ind + ']' : '[]';
  var ks = Object.keys(v);
  return ks.length ? '{\n' + ks.map(function (k) { return nx + pystr(k) + ': ' + pyval(v[k], nx); }).join(',\n') + ',\n' + ind + '}' : '{}';
}
function jsval(v, ind) { return JSON.stringify(v, null, 2).replace(/\n/g, '\n' + ind); }
function phpval(v, ind) {
  ind = ind || ''; var nx = ind + '    ';
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return phpstr(v);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return nx + phpval(x, nx); }).join(',\n') + ',\n' + ind + ']' : '[]';
  var ks = Object.keys(v);
  return ks.length ? '[\n' + ks.map(function (k) { return nx + phpstr(k) + ' => ' + phpval(v[k], nx); }).join(',\n') + ',\n' + ind + ']' : 'new stdClass()';
}
function b64ascii(s) { try { return typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); } catch (e) { return ''; } }

T.curlToPython = function (r) {
  var L = ['import requests', ''], args = ['url'], hs = r.headers.slice(), cookies = null;
  var ci = hdrFind(hs, 'cookie');
  if (ci >= 0) { cookies = hs[ci][1].split(/;\s*/).filter(Boolean).map(function (p) { var e = p.indexOf('='); return [p.slice(0, e < 0 ? p.length : e).trim(), e < 0 ? '' : p.slice(e + 1)]; }); hs.splice(ci, 1); }
  var useJson = r.json !== undefined, useForm = !useJson && r.formPairs && r.implicitForm;
  if (useJson) { var ct = hdrFind(hs, 'content-type'); if (ct >= 0 && /^application\/json$/i.test(hs[ct][1].trim())) hs.splice(ct, 1); }
  if (useForm) hs.splice(hdrFind(hs, 'content-type'), 1);
  L.push('url = ' + pystr(r.url));
  if (hs.length) { L.push('headers = {'); hs.forEach(function (h) { L.push('    ' + pystr(h[0]) + ': ' + pystr(h[1]) + ','); }); L.push('}'); args.push('headers=headers'); }
  if (cookies) { L.push('cookies = {'); cookies.forEach(function (c) { L.push('    ' + pystr(c[0]) + ': ' + pystr(c[1]) + ','); }); L.push('}'); args.push('cookies=cookies'); }
  if (r.body !== null) {
    if (useJson) { L.push('json_data = ' + pyval(r.json)); args.push('json=json_data'); }
    else if (useForm) {
      var dup = {}, hasDup = r.formPairs.some(function (p) { if (dup[p[0]]) return true; dup[p[0]] = 1; return false; });
      if (hasDup) { L.push('data = ['); r.formPairs.forEach(function (p) { L.push('    (' + pystr(p[0]) + ', ' + pystr(p[1]) + '),'); }); L.push(']'); }
      else { L.push('data = {'); r.formPairs.forEach(function (p) { L.push('    ' + pystr(p[0]) + ': ' + pystr(p[1]) + ','); }); L.push('}'); }
      args.push('data=data');
    } else { L.push('data = ' + pystr(r.body)); args.push(/[^\x00-\x7f]/.test(r.body) ? "data=data.encode('utf-8')" : 'data=data'); }
  }
  if (r.form.length) {
    var plain = r.form.filter(function (f) { return !f.file; }), files = r.form.filter(function (f) { return f.file; });
    if (files.length) {
      L.push('files = {');
      files.forEach(function (f) { var fname = f.filename || f.file.split('/').pop(); L.push('    ' + pystr(f.name) + ': (' + pystr(fname) + ', open(' + pystr(f.file) + ", 'rb')" + (f.type ? ', ' + pystr(f.type) : '') + '),'); });
      L.push('}'); args.push('files=files');
    } else { args.push('files=files'); L.push('files = {'); plain.forEach(function (f) { L.push('    ' + pystr(f.name) + ': (None, ' + pystr(f.value) + '),'); }); L.push('}'); plain = []; }
    if (plain.length) { L.push('data = {'); plain.forEach(function (f) { L.push('    ' + pystr(f.name) + ': ' + pystr(f.value) + ','); }); L.push('}'); args.push('data=data'); }
  }
  if (r.auth) args.push('auth=(' + pystr(r.auth[0]) + ', ' + pystr(r.auth[1]) + ')');
  if (r.proxy) { L.push('proxies = {' + pystr('http') + ': ' + pystr(r.proxy) + ', ' + pystr('https') + ': ' + pystr(r.proxy) + '}'); args.push('proxies=proxies'); }
  if (r.timeout) args.push('timeout=' + r.timeout);
  if (r.insecure) args.push('verify=False');
  if (r.method === 'HEAD' && r.follow) args.push('allow_redirects=True');
  L.push('');
  var fn = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' }[r.method];
  var call = fn ? 'requests.' + fn + '(' : 'requests.request(' + pystr(r.method) + ', ';
  var one = call + args.join(', ') + ')';
  L.push('response = ' + (one.length <= 88 ? one : call + '\n    ' + args.join(',\n    ') + ',\n)'));
  L.push('print(response.status_code)', 'print(response.text)');
  return L.join('\n') + '\n';
};

T.curlToFetch = function (r) {
  var L = [], o = [], hs = r.headers.slice();
  if (r.auth) hs.push(['Authorization', 'Basic ' + b64ascii(r.auth[0] + ':' + r.auth[1])]);
  if (r.method !== 'GET') o.push('  method: ' + jstr(r.method));
  if (hs.length) o.push('  headers: {\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') + '\n  }');
  if (r.body !== null) o.push('  body: ' + (r.json !== undefined ? 'JSON.stringify(' + jsval(r.json, '  ') + ')' : r.formPairs && r.implicitForm ? 'new URLSearchParams(' + jsval(r.formPairs.reduce(function (a, p) { a.push(p); return a; }, []), '  ') + ')' : jstr(r.body)));
  if (r.form.length) {
    L.push('const form = new FormData();');
    r.form.forEach(function (f) {
      if (f.file) L.push('form.append(' + jstr(f.name) + ', fileInput.files[0], ' + jstr(f.filename || f.file.split('/').pop()) + '); // the file ' + f.file + ' (in Node 20+: await fs.openAsBlob(' + jstr(f.file) + '))');
      else L.push('form.append(' + jstr(f.name) + ', ' + jstr(f.value) + ');');
    });
    L.push('');
    o.push('  body: form');
  }
  if (r.timeout) o.push('  signal: AbortSignal.timeout(' + Math.round(r.timeout * 1000) + ')');
  if (r.insecure) L.unshift('// -k/--insecure has no fetch equivalent in browsers. In Node you can (for testing only) run with NODE_TLS_REJECT_UNAUTHORIZED=0.');
  if (hs.some(function (h) { return /^(cookie|user-agent|referer|host|accept-encoding|content-length|connection|origin)$/i.test(h[0]); })) L.unshift('// Note: browsers silently drop "forbidden" headers such as Cookie, User-Agent, Referer and Host. This runs as-is in Node 18+.');
  if (r.proxy) L.unshift('// Proxy ' + r.proxy + ': fetch has no proxy option; in Node use undici\'s ProxyAgent as the "dispatcher" option.');
  L.push('const response = await fetch(' + jstr(r.url) + (o.length ? ', {\n' + o.join(',\n') + '\n}' : '') + ');');
  L.push('console.log(response.status);', 'console.log(await response.text());');
  return L.join('\n') + '\n';
};

T.curlToAxios = function (r) {
  var L = ['const axios = require("axios");'], o = [], pre = [], hs = r.headers.slice();
  if (r.insecure) { L.push('const https = require("https");'); }
  if (r.form.length) { L.push('const FormData = require("form-data");'); if (r.form.some(function (f) { return f.file; })) L.push('const fs = require("fs");'); }
  L.push('');
  if (r.form.length) {
    pre.push('const form = new FormData();');
    r.form.forEach(function (f) { pre.push('form.append(' + jstr(f.name) + ', ' + (f.file ? 'fs.createReadStream(' + jstr(f.file) + ')' : jstr(f.value)) + ');'); });
    pre.push('');
  }
  o.push('  method: ' + jstr(r.method.toLowerCase()), '  url: ' + jstr(r.url));
  if (r.form.length) o.push('  headers: {\n    ...form.getHeaders()' + (hs.length ? ',\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') : '') + '\n  }');
  else if (hs.length) o.push('  headers: {\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') + '\n  }');
  if (r.body !== null) o.push('  data: ' + (r.json !== undefined ? jsval(r.json, '  ') : jstr(r.body)));
  if (r.form.length) o.push('  data: form');
  if (r.auth) o.push('  auth: { username: ' + jstr(r.auth[0]) + ', password: ' + jstr(r.auth[1]) + ' }');
  if (r.timeout) o.push('  timeout: ' + Math.round(r.timeout * 1000));
  if (r.insecure) o.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false })');
  if (r.proxy) { var pm = /^(\w+):\/\/(?:([^:@]*)(?::([^@]*))?@)?([^:\/]+)(?::(\d+))?/.exec(r.proxy); if (pm) o.push('  proxy: { protocol: ' + jstr(pm[1]) + ', host: ' + jstr(pm[4]) + ', port: ' + (pm[5] || (pm[1] === 'https' ? 443 : 1080)) + (pm[2] ? ', auth: { username: ' + jstr(decodeURIComponent(pm[2])) + ', password: ' + jstr(decodeURIComponent(pm[3] || '')) + ' }' : '') + ' }'); }
  return L.concat(pre).join('\n') + 'axios({\n' + o.join(',\n') + '\n})\n  .then((response) => {\n    console.log(response.status);\n    console.log(response.data);\n  })\n  .catch((error) => console.error(error.response ? error.response.status : error.message));\n';
};

T.curlToGo = function (r) {
  var imp = { 'fmt': 1, 'io': 1, 'net/http': 1 }, B = [];
  var bodyVar = 'nil';
  if (r.body !== null) { imp.strings = 1; bodyVar = 'body'; B.push('\tbody := strings.NewReader(' + (r.body.indexOf('`') < 0 && /\n/.test(r.body) ? '`' + r.body + '`' : jstr(r.body)) + ')'); }
  if (r.form.length) {
    imp.bytes = 1; imp['mime/multipart'] = 1; bodyVar = 'payload';
    B.push('\tpayload := &bytes.Buffer{}', '\twriter := multipart.NewWriter(payload)');
    r.form.forEach(function (f) {
      if (f.file) {
        imp.os = 1; imp['path/filepath'] = 1;
        B.push('\t{', '\t\tf, err := os.Open(' + jstr(f.file) + ')', '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}', '\t\tdefer f.Close()',
          '\t\tpart, err := writer.CreateFormFile(' + jstr(f.name) + ', ' + (f.filename ? jstr(f.filename) : 'filepath.Base(' + jstr(f.file) + ')') + ')', '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}',
          '\t\tif _, err := io.Copy(part, f); err != nil {', '\t\t\tpanic(err)', '\t\t}', '\t}');
      } else B.push('\t_ = writer.WriteField(' + jstr(f.name) + ', ' + jstr(f.value) + ')');
    });
    B.push('\twriter.Close()');
  }
  B.push('', '\treq, err := http.NewRequest(' + jstr(r.method) + ', ' + jstr(r.url) + ', ' + bodyVar + ')', '\tif err != nil {', '\t\tpanic(err)', '\t}');
  r.headers.forEach(function (h) { B.push('\treq.Header.' + (h[0].toLowerCase() === 'host' ? 'Set' : 'Set') + '(' + jstr(h[0]) + ', ' + jstr(h[1]) + ')'); });
  if (hdrFind(r.headers, 'host') >= 0) B.push('\treq.Host = req.Header.Get("Host")');
  if (r.form.length) B.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  if (r.auth) B.push('\treq.SetBasicAuth(' + jstr(r.auth[0]) + ', ' + jstr(r.auth[1]) + ')');
  var cl = [];
  if (r.timeout) { imp.time = 1; cl.push('\t\tTimeout: ' + (r.timeout >= 1 && r.timeout === Math.round(r.timeout) ? r.timeout + ' * time.Second' : Math.round(r.timeout * 1000) + ' * time.Millisecond') + ','); }
  if (r.insecure || r.proxy) {
    var tr = [];
    if (r.insecure) { imp['crypto/tls'] = 1; tr.push('\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},'); }
    if (r.proxy) { imp['net/url'] = 1; B.push('\tproxyURL, _ := url.Parse(' + jstr(r.proxy) + ')'); tr.push('\t\t\tProxy:' + (r.insecure ? '           ' : ' ') + 'http.ProxyURL(proxyURL),'); }
    cl.push('\t\tTransport: &http.Transport{\n' + tr.join('\n') + '\n\t\t},');
  }
  B.push('', cl.length ? '\tclient := &http.Client{\n' + cl.join('\n') + '\n\t}' : '\tclient := &http.Client{}');
  B.push('\tresp, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()', '', '\trespBody, err := io.ReadAll(resp.Body)', '\tif err != nil {', '\t\tpanic(err)', '\t}',
    '\tfmt.Println(resp.Status)', '\tfmt.Println(string(respBody))');
  var imports = Object.keys(imp).sort();
  return 'package main\n\nimport (\n' + imports.map(function (x) { return '\t"' + x + '"'; }).join('\n') + '\n)\n\nfunc main() {\n' + B.join('\n').replace(/^\n/, '') + '\n}\n';
};

T.curlToPhp = function (r) {
  var L = ['<?php', '', '$ch = curl_init();', 'curl_setopt($ch, CURLOPT_URL, ' + phpstr(r.url) + ');', 'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);'];
  if (r.method === 'HEAD') L.push('curl_setopt($ch, CURLOPT_NOBODY, true);');
  else if (r.method !== 'GET' && !(r.method === 'POST' && (r.body !== null || r.form.length))) L.push('curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ' + phpstr(r.method) + ');');
  if (r.headers.length) { L.push('curl_setopt($ch, CURLOPT_HTTPHEADER, ['); r.headers.forEach(function (h) { L.push('    ' + phpstr(h[0] + ': ' + h[1]) + ','); }); L.push(']);'); }
  if (r.body !== null) L.push('curl_setopt($ch, CURLOPT_POSTFIELDS, ' + phpstr(r.body) + ');');
  if (r.form.length) {
    L.push('curl_setopt($ch, CURLOPT_POSTFIELDS, [');
    r.form.forEach(function (f) { L.push('    ' + phpstr(f.name) + ' => ' + (f.file ? 'new CURLFile(' + phpstr(f.file) + (f.type || f.filename ? ', ' + phpstr(f.type || '') + (f.filename ? ', ' + phpstr(f.filename) : '') : '') + ')' : phpstr(f.value)) + ','); });
    L.push(']);');
  }
  if (r.auth) L.push('curl_setopt($ch, CURLOPT_USERPWD, ' + phpstr(r.auth[0] + ':' + r.auth[1]) + ');');
  if (r.digest) L.push('curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_DIGEST);');
  if (r.follow) L.push('curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);');
  if (r.compressed) L.push("curl_setopt($ch, CURLOPT_ENCODING, ''); // --compressed: accept and decode gzip/deflate/br");
  if (r.insecure) L.push('curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);', 'curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);');
  if (r.timeout) L.push('curl_setopt($ch, CURLOPT_TIMEOUT, ' + Math.ceil(r.timeout) + ');');
  if (r.proxy) L.push('curl_setopt($ch, CURLOPT_PROXY, ' + phpstr(r.proxy) + ');');
  L.push('', '$response = curl_exec($ch);', 'if ($response === false) {', "    echo 'cURL error: ' . curl_error($ch) . PHP_EOL;", '} else {',
    '    echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . PHP_EOL;', '    echo $response . PHP_EOL;', '}', 'curl_close($ch);');
  return L.join('\n') + '\n';
};
T.CURL_LANGS = { python: T.curlToPython, fetch: T.curlToFetch, axios: T.curlToAxios, go: T.curlToGo, php: T.curlToPhp };
/* ---------------- .gitignore generator & tester ---------------- */
T.GITIGNORE = {
  Node: { label: 'Node.js / npm / Yarn / pnpm', body: '# Dependencies\nnode_modules/\njspm_packages/\n.pnpm-store/\n\n# Logs\nlogs/\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n# Build output and caches\ndist/\nbuild/\ncoverage/\n.nyc_output/\n.cache/\n.parcel-cache/\n.next/\n.nuxt/\n.svelte-kit/\n.turbo/\n.vite/\n.eslintcache\n*.tsbuildinfo\n\n# Yarn Berry (keep the files that should be committed)\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/sdks\n!.yarn/versions\n.pnp.*\n\n# Environment files (commit a .env.example instead)\n.env\n.env.*\n!.env.example' },
  Python: { label: 'Python', body: '# Byte-compiled files\n__pycache__/\n*.py[cod]\n*$py.class\n\n# Virtual environments\n.venv/\nvenv/\nenv/\nENV/\n\n# Packaging\nbuild/\ndist/\n*.egg-info/\n.eggs/\nwheels/\n*.egg\n\n# Test, type-check and lint caches\n.pytest_cache/\n.coverage\n.coverage.*\nhtmlcov/\n.tox/\n.nox/\n.mypy_cache/\n.ruff_cache/\n.pytype/\n\n# Jupyter\n.ipynb_checkpoints/\n\n# Environment files\n.env\n.env.*\n!.env.example' },
  Java: { label: 'Java (Maven / Gradle)', body: '# Compiled classes and packages\n*.class\n*.jar\n*.war\n*.ear\n*.nar\nhs_err_pid*\nreplay_pid*\n\n# Maven\ntarget/\npom.xml.tag\npom.xml.releaseBackup\npom.xml.versionsBackup\nrelease.properties\n.mvn/timing.properties\n!.mvn/wrapper/maven-wrapper.jar\n\n# Gradle\n.gradle/\nbuild/\n!gradle/wrapper/gradle-wrapper.jar\n\n# Eclipse / NetBeans\n.classpath\n.project\n.settings/\nbin/\nnbproject/private/' },
  Go: { label: 'Go', body: '# Binaries\n*.exe\n*.exe~\n*.dll\n*.so\n*.dylib\n\n# Test binaries and coverage\n*.test\n*.out\ncoverage.*\n\n# Workspace file (usually local)\ngo.work\ngo.work.sum\n\n# Vendored dependencies (remove this line if you commit vendor/)\n# vendor/' },
  Rust: { label: 'Rust / Cargo', body: '# Build output\ntarget/\n\n# Backup files from rustfmt\n**/*.rs.bk\n\n# Debug info on Windows\n*.pdb\n\n# Libraries usually do not commit Cargo.lock; applications should.\n# Cargo.lock' },
  Docker: { label: 'Docker', body: '# Local overrides and secrets\ndocker-compose.override.yml\ncompose.override.yaml\n.env\n\n# Data volumes mounted into the project folder\n.docker-data/' },
  Terraform: { label: 'Terraform', body: '# Local state and provider plugins\n.terraform/\n*.tfstate\n*.tfstate.*\ncrash.log\ncrash.*.log\n\n# Variable files often contain secrets\n*.tfvars\n*.tfvars.json\n\n# Local overrides\noverride.tf\noverride.tf.json\n*_override.tf\n*_override.tf.json\n.terraformrc\nterraform.rc\n\n# Commit .terraform.lock.hcl: it pins provider versions' },
  PHP: { label: 'PHP / Composer', body: '# Composer\nvendor/\ncomposer.phar\n\n# Framework caches (Laravel / Symfony)\n.phpunit.result.cache\n.php-cs-fixer.cache\nstorage/*.key\nvar/cache/\nvar/log/\n\n# Environment files\n.env\n.env.*\n!.env.example' },
  Ruby: { label: 'Ruby / Rails', body: '# Bundler\n.bundle/\nvendor/bundle/\n\n# Rails\nlog/*\ntmp/*\n!log/.keep\n!tmp/.keep\nstorage/*\n!storage/.keep\npublic/assets/\n/config/master.key\n\n# Gems\n*.gem\ncoverage/' },
  DotNet: { label: '.NET / C#', body: '# Build output\n[Bb]in/\n[Oo]bj/\n[Dd]ebug/\n[Rr]elease/\nx64/\nx86/\n[Ll]og/\n\n# Visual Studio\n.vs/\n*.user\n*.suo\n*.userprefs\n\n# NuGet\n*.nupkg\n*.snupkg\npackages/\n!**/packages/build/\n\n# Test results\nTestResults/\n[Tt]est[Rr]esult*/' },
  Android: { label: 'Android', body: '# Gradle and build output\n.gradle/\nbuild/\n/captures\n.externalNativeBuild/\n.cxx/\n\n# Local configuration (SDK path)\nlocal.properties\n\n# Android Studio\n*.iml\n.idea/\n\n# Signing keys: never commit these\n*.jks\n*.keystore\n\n# Generated files\n*.apk\n*.aab\n*.ap_\n*.dex\noutput-metadata.json' },
  macOS: { label: 'macOS', body: '# macOS Finder and system files\n.DS_Store\n.AppleDouble\n.LSOverride\n._*\n.Spotlight-V100\n.Trashes\n.fseventsd\n.DocumentRevisions-V100\n.TemporaryItems\n.VolumeIcon.icns' },
  Windows: { label: 'Windows', body: '# Windows thumbnail and folder files\nThumbs.db\nThumbs.db:encryptable\nehthumbs.db\nehthumbs_vista.db\ndesktop.ini\n$RECYCLE.BIN/\n\n# Windows shortcuts\n*.lnk\n\n# Installer caches\n*.stackdump' },
  Linux: { label: 'Linux', body: '# Editor backup and temporary files\n*~\n.fuse_hidden*\n.directory\n.Trash-*\n.nfs*' },
  VSCode: { label: 'VS Code', body: '# VS Code: ignore personal settings but keep shared ones\n.vscode/*\n!.vscode/settings.json\n!.vscode/tasks.json\n!.vscode/launch.json\n!.vscode/extensions.json\n!.vscode/*.code-snippets\n.history/\n*.vsix' },
  JetBrains: { label: 'JetBrains (IntelliJ, PyCharm, WebStorm…)', body: '# JetBrains IDEs\n.idea/\n*.iml\n*.ipr\n*.iws\nout/\n.idea_modules/\n\n# If you share run configurations, use these instead of ignoring .idea/ entirely:\n# .idea/workspace.xml\n# .idea/tasks.xml\n# .idea/usage.statistics.xml' },
  Vim: { label: 'Vim / Emacs', body: '# Vim swap, undo and session files\n[._]*.s[a-v][a-z]\n!*.svg\n[._]*.sw[a-p]\n[._]s[a-rt-v][a-z]\n[._]ss[a-gi-z]\n[._]sw[a-p]\nSession.vim\nSessionx.vim\n.netrwhist\ntags\n[._]*.un~\n\n# Emacs\n*~\n\\#*\\#\n.\\#*' },
  Secrets: { label: 'Secrets & keys (recommended)', body: '# Private keys and credentials: never commit these\n*.pem\n*.key\n*.p12\n*.pfx\nid_rsa\nid_ed25519\n*.secret\nsecrets.*\n!secrets.example.*\n.env\n.env.*\n!.env.example' }
};

// Combine templates and drop duplicate patterns, unless a "!" rule in between could make the order matter.
T.gitignoreCombine = function (names, extra) {
  var out = [], seen = {};
  names.forEach(function (n) {
    var t = T.GITIGNORE[n]; if (!t) return;
    out.push('### ' + t.label + ' ###');
    t.body.split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split('\n'), kept = [], pats = 0, dropped = 0;
      lines.forEach(function (line) {
        var pat = line.trim();
        if (!pat || pat.charAt(0) === '#') { kept.push(line); return; }
        pats++;
        if (pat.charAt(0) === '!') { Object.keys(seen).forEach(function (k) { seen[k].push(pat.slice(1)); }); kept.push(line); return; }
        if (seen[pat] && !seen[pat].some(function (neg) { return T.gitignoreCheck(pat, neg).ignored || T.gitignoreCheck(neg, pat.replace(/\/$/, '')).ignored; })) { dropped++; return; }
        seen[pat] = []; kept.push(line);
      });
      if (pats && dropped === pats) return;
      out.push(kept.join('\n'), '');
    });
  });
  if (extra && extra.trim()) out.push('### Custom ###', extra.trim(), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
};

// Compile one gitignore pattern into a matcher, following git's wildmatch rules.
function giGlobToRe(p) {
  var re = '', i = 0, n = p.length;
  while (i < n) {
    var c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        var atStart = i === 0 || p[i - 1] === '/', j = i; while (p[j] === '*') j++;
        var atEnd = j === n || p[j] === '/';
        if (atStart && atEnd) {
          if (j === n) { re += i === 0 ? '.*' : '.*'; i = j; continue; }          // "**" at end: everything inside
          re += '(?:.*/)?'; i = j + 1; continue;                                   // "**/": zero or more directories
        }
        re += '[^/]*'; i = j; continue;
      }
      re += '[^/]*'; i++; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '[') {
      var k = i + 1, cls = '';
      if (p[k] === '!' || p[k] === '^') { cls = '^'; k++; }
      if (p[k] === ']') { cls += '\\]'; k++; }
      while (k < n && p[k] !== ']') {
        if (p[k] === '\\' && k + 1 < n) { cls += '\\' + p[k + 1]; k += 2; continue; }
        if (p[k] === '[' && p[k + 1] === ':') { var e = p.indexOf(':]', k + 2); if (e > 0) { var nm = p.slice(k + 2, e); cls += ({ alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', xdigit: '0-9a-fA-F', punct: '!-\\/:-@\\[-`{-~' })[nm] || ''; k = e + 2; continue; } }
        cls += /[\]\\^]/.test(p[k]) ? '\\' + p[k] : p[k]; k++;
      }
      if (k >= n) { re += '\\['; i++; continue; }  // unterminated class: literal "["
      re += cls.charAt(0) === '^' ? '(?![/])[' + cls + ']' : '[' + cls + ']'; i = k + 1; continue;
    }
    if (c === '\\' && i + 1 < n) { re += p[i + 1].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i += 2; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i++;
  }
  return re;
}

T.gitignoreParse = function (text) {
  var rules = [];
  String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (raw, idx) {
    var line = raw;
    // trailing spaces are ignored unless escaped with a backslash
    line = line.replace(/((?:\\\\)*)(\\?) +$/, function (m, bs, esc1) { return bs + (esc1 ? ' ' : ''); });
    if (!line || line.charAt(0) === '#') return;
    var neg = false;
    if (line.charAt(0) === '!') { neg = true; line = line.slice(1); }
    else if (line.slice(0, 2) === '\\!' || line.slice(0, 2) === '\\#') line = line.slice(1);
    if (!line) return;
    var dirOnly = false;
    if (/[^\\]\/$|^\/$/.test(line)) { dirOnly = true; line = line.replace(/\/+$/, ''); }
    if (!line) return;
    var anchored = line.indexOf('/') >= 0;
    if (line.charAt(0) === '/') line = line.slice(1);
    var re = giGlobToRe(line);
    rules.push({ line: idx + 1, text: raw.replace(/\s+$/, ''), neg: neg, dirOnly: dirOnly, anchored: anchored, re: new RegExp('^' + re + '$') });
  });
  return rules;
};

function giMatchOne(rules, path, isDir) {
  var base = path.slice(path.lastIndexOf('/') + 1), hit = null;
  for (var i = rules.length - 1; i >= 0; i--) {
    var r = rules[i];
    if (r.dirOnly && !isDir) continue;
    if (r.anchored ? r.re.test(path) : r.re.test(base)) { hit = r; break; }
  }
  return hit;
}

// Is a path ignored? Mirrors git: a path inside an ignored directory is ignored, and cannot be re-included by a later "!" rule.
T.gitignoreCheck = function (rules, path) {
  if (typeof rules === 'string') rules = T.gitignoreParse(rules);
  var p = String(path).replace(/^\s+|[\r\n]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  var isDir = /\/$/.test(p); p = p.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (!p) return { ignored: false, rule: null, path: p };
  var parts = p.split('/');
  for (var d = 1; d < parts.length; d++) {
    var dir = parts.slice(0, d).join('/'), h = giMatchOne(rules, dir, true);
    if (h && !h.neg) return { ignored: true, rule: h, path: p, via: dir + '/', isDir: isDir };
  }
  var hit = giMatchOne(rules, p, isDir);
  return { ignored: !!(hit && !hit.neg), rule: hit, path: p, isDir: isDir };
};
/* ---------------- CSV <-> JSON ---------------- */
// RFC 4180 parser: quoted fields, "" escapes, delimiters and line breaks inside quotes, CRLF/LF/CR line endings.
T.csvParse = function (text, delim, limit) {
  var s = String(text), rows = [], row = [], f = '', i = 0, n = s.length, q = false, quotedField = false, warn = [];
  if (s.charCodeAt(0) === 0xfeff) i = 1;
  delim = delim || ',';
  function endField() { row.push(f); f = ''; quotedField = false; }
  function endRow() { endField(); rows.push(row); row = []; }
  while (i < n) {
    var c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '' && !quotedField) { q = true; quotedField = true; i++; continue; }
    if (c === '"' && quotedField) { f += c; i++; if (warn.length < 5) warn.push('Stray quote after a closing quote on row ' + (rows.length + 1)); continue; }
    if (c === delim) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') { endRow(); i += c === '\r' && s[i + 1] === '\n' ? 2 : 1; if (limit && rows.length >= limit) return { rows: rows, warnings: warn, truncated: true }; continue; }
    f += c; i++;
  }
  if (q) warn.push('Unclosed quote: a field starting with " never ends (row ' + (rows.length + 1) + ')');
  if (f !== '' || row.length || quotedField) endRow();
  return { rows: rows, warnings: warn };
};

T.csvDetectDelimiter = function (text) {
  var sample = String(text).slice(0, 20000), best = ',', bestScore = -1;
  [',', ';', '\t', '|'].forEach(function (d) {
    var rows = T.csvParse(sample, d, 30).rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
    if (rows.length > 1 && sample.length >= 20000) rows.pop(); // last row may be cut off
    if (!rows.length) return;
    var counts = rows.map(function (r) { return r.length; }), first = counts[0];
    if (first < 2) return;
    var same = counts.filter(function (c) { return c === first; }).length / counts.length;
    var score = same * 100 + Math.min(first, 50);
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best;
};

function csvInfer(v) {
  if (v === '') return null;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(v)) { var x = Number(v); if (isFinite(x)) return x; }
  if (v === 'true' || v === 'TRUE' || v === 'True') return true;
  if (v === 'false' || v === 'FALSE' || v === 'False') return false;
  if (v === 'null' || v === 'NULL') return null;
  return v;
}

T.csvToJson = function (text, opts) {
  opts = opts || {};
  var d = !opts.delimiter || opts.delimiter === 'auto' ? T.csvDetectDelimiter(text) : opts.delimiter;
  var p = T.csvParse(text, d), rows = p.rows;
  if (opts.skipEmpty !== false) rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  var conv = opts.infer ? csvInfer : function (v) { return v; };
  var warnings = p.warnings.slice(), data;
  if (opts.header !== false && rows.length) {
    var used = {}, keys = rows[0].map(function (h, k) {
      var key = h.trim() || 'column_' + (k + 1), base = key, m = 2;
      while (used[key]) key = base + '_' + m++;
      if (key !== base) warnings.push('Duplicate column name "' + base + '" renamed to "' + key + '"');
      used[key] = 1; return key;
    });
    var ragged = 0;
    data = rows.slice(1).map(function (r) {
      var o = {};
      if (r.length !== keys.length) ragged++;
      for (var k = 0; k < Math.max(keys.length, r.length); k++) {
        var key = k < keys.length ? keys[k] : 'column_' + (k + 1);
        o[key] = k < r.length ? conv(r[k]) : (opts.infer ? null : '');
      }
      return o;
    });
    if (ragged) warnings.push(ragged + ' row' + (ragged > 1 ? 's have' : ' has') + ' a different number of fields than the header (' + keys.length + ')');
  } else data = rows.map(function (r) { return r.map(conv); });
  return { data: data, delimiter: d, rows: rows.length, warnings: warnings };
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function csvQuote(s, d, always) {
  return always || s.indexOf(d) >= 0 || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
T.jsonToCsv = function (value, opts) {
  opts = opts || {};
  var d = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : ',', eol = opts.crlf ? '\r\n' : '\n', lines = [];
  if (typeof value === 'string') value = JSON.parse(value);
  if (value && !Array.isArray(value) && typeof value === 'object') {
    var ks0 = Object.keys(value);
    // {"items": [...]} wrapper: use the first array property
    var arrKey = ks0.filter(function (k) { return Array.isArray(value[k]) && value[k].length && typeof value[k][0] === 'object'; })[0];
    value = arrKey && ks0.length <= 3 ? value[arrKey] : [value];
  }
  if (!Array.isArray(value)) throw new Error('Expected a JSON array (of objects or of arrays).');
  var flat = opts.flatten !== false;
  function flatten(o, pre, out) {
    Object.keys(o).forEach(function (k) {
      var v = o[k], key = pre ? pre + '.' + k : k;
      if (flat && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, key, out); else out[key] = v;
    });
    return out;
  }
  if (value.every(function (r) { return Array.isArray(r); })) {
    value.forEach(function (r) { lines.push(r.map(function (c) { return csvQuote(csvCell(c), d, opts.quoteAll); }).join(d)); });
    return lines.join(eol) + (lines.length ? eol : '');
  }
  var rows = value.map(function (r) { return r && typeof r === 'object' && !Array.isArray(r) ? flatten(r, '', {}) : { value: r }; });
  var keys = [], seen = {};
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } }); });
  if (opts.header !== false) lines.push(keys.map(function (k) { return csvQuote(k, d, opts.quoteAll); }).join(d));
  rows.forEach(function (r) { lines.push(keys.map(function (k) { return csvQuote(csvCell(r[k]), d, opts.quoteAll); }).join(d)); });
  return lines.join(eol) + eol;
};
/* ---------------- Subnet / CIDR calculator ---------------- */
T.ip4Parse = function (s) {
  s = String(s).trim();
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) throw new Error('"' + s + '" is not a valid IPv4 address (expected four numbers like 192.168.1.10).');
  var n = 0;
  for (var k = 1; k <= 4; k++) {
    if (m[k].length > 1 && m[k][0] === '0') throw new Error('"' + s + '": leading zeros are ambiguous (some tools read them as octal). Write ' + m.slice(1).map(function (x) { return +x; }).join('.') + '.');
    var v = +m[k]; if (v > 255) throw new Error('"' + s + '": each part must be 0-255, got ' + v + '.');
    n = n * 256 + v;
  }
  return n;
};
T.ip4Str = function (n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); };
function ip4Mask(p) { return p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0; }
function ip4Bin(n) { var b = ('0'.repeat(32) + n.toString(2)).slice(-32); return b.slice(0, 8) + '.' + b.slice(8, 16) + '.' + b.slice(16, 24) + '.' + b.slice(24); }
T.ip4MaskToPrefix = function (s) {
  var n = T.ip4Parse(s), p = 0;
  while (p < 32 && (n & (0x80000000 >>> p))) p++;
  if (ip4Mask(p) !== n) {
    var inv = (~n) >>> 0, q = 0; while (q < 32 && (inv & (0x80000000 >>> q))) q++;
    if (ip4Mask(q) === inv) return { prefix: q, wildcard: true };
    throw new Error(s + ' is not a valid netmask (the 1 bits must be contiguous, e.g. 255.255.255.0).');
  }
  return { prefix: p };
};
function ip4Type(n) {
  var R = [['0.0.0.0', 8, 'This network (0.0.0.0/8)'], ['10.0.0.0', 8, 'Private (RFC 1918)'], ['100.64.0.0', 10, 'Carrier-grade NAT / shared (RFC 6598)'], ['127.0.0.0', 8, 'Loopback'],
    ['169.254.0.0', 16, 'Link-local (APIPA)'], ['172.16.0.0', 12, 'Private (RFC 1918)'], ['192.0.0.0', 24, 'IETF protocol assignments'], ['192.0.2.0', 24, 'Documentation (TEST-NET-1)'],
    ['192.88.99.0', 24, 'Reserved (6to4 relay)'], ['192.168.0.0', 16, 'Private (RFC 1918)'], ['198.18.0.0', 15, 'Benchmarking (RFC 2544)'], ['198.51.100.0', 24, 'Documentation (TEST-NET-2)'],
    ['203.0.113.0', 24, 'Documentation (TEST-NET-3)'], ['224.0.0.0', 4, 'Multicast'], ['255.255.255.255', 32, 'Limited broadcast'], ['240.0.0.0', 4, 'Reserved (class E)']];
  for (var k = 0; k < R.length; k++) { var b = T.ip4Parse(R[k][0]), m = ip4Mask(R[k][1]); if (((n & m) >>> 0) === b) return R[k][2]; }
  return 'Public (globally routable)';
}
// Accepts "10.0.0.5/24", "10.0.0.5 255.255.255.0", "10.0.0.5/255.255.255.0" or a bare address (/32).
T.cidrParse = function (s) {
  s = String(s).trim();
  var m = /^([\d.]+)\s*(?:\/\s*(\d{1,2})|[\/\s]\s*([\d.]+))?$/.exec(s);
  if (!m) throw new Error('Enter an IPv4 network like 192.168.1.0/24 or 10.0.0.5 255.255.255.0.');
  var ip = T.ip4Parse(m[1]), p = 32;
  if (m[2] !== undefined) { p = +m[2]; if (p > 32) throw new Error('The prefix length must be between 0 and 32.'); }
  else if (m[3] !== undefined) p = T.ip4MaskToPrefix(m[3]).prefix;
  return { ip: ip, prefix: p };
};
T.cidrInfo = function (s) {
  var c = typeof s === 'string' ? T.cidrParse(s) : s, p = c.prefix, mask = ip4Mask(p), net = (c.ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
  var total = Math.pow(2, 32 - p), first, last, usable;
  if (p === 32) { first = last = net; usable = 1; }
  else if (p === 31) { first = net; last = bc; usable = 2; }
  else { first = net + 1; last = bc - 1; usable = total - 2; }
  var o1 = net >>> 24;
  return {
    input: T.ip4Str(c.ip) + '/' + p, prefix: p, address: T.ip4Str(c.ip), network: T.ip4Str(net), broadcast: p >= 31 ? null : T.ip4Str(bc), netmask: T.ip4Str(mask),
    wildcard: T.ip4Str(~mask >>> 0), first: T.ip4Str(first), last: T.ip4Str(last), total: total, usable: usable, cidr: T.ip4Str(net) + '/' + p,
    hostBitsSet: c.ip !== net, type: ip4Type(c.ip), cls: o1 < 128 ? 'A' : o1 < 192 ? 'B' : o1 < 224 ? 'C' : o1 < 240 ? 'D (multicast)' : 'E (reserved)',
    binMask: ip4Bin(mask), binAddr: ip4Bin(c.ip), hex: '0x' + ('00000000' + c.ip.toString(16)).slice(-8), int: c.ip, netInt: net, bcInt: bc,
    ptr: p % 8 === 0 && p > 0 ? T.ip4Str(net).split('.').slice(0, p / 8).reverse().join('.') + '.in-addr.arpa' : null
  };
};
T.cidrContains = function (cidr, ip) {
  var c = T.cidrInfo(cidr), n = typeof ip === 'number' ? ip : T.ip4Parse(ip);
  return n >= c.netInt && n <= c.bcInt;
};
T.cidrSplit = function (cidr, newPrefix, max) {
  var c = T.cidrInfo(cidr), np = +newPrefix;
  if (!(np >= c.prefix && np <= 32)) throw new Error('The new prefix must be between /' + c.prefix + ' and /32.');
  var count = Math.pow(2, np - c.prefix), size = Math.pow(2, 32 - np), out = [];
  for (var k = 0; k < count && k < (max || 256); k++) out.push(T.cidrInfo({ ip: c.netInt + k * size, prefix: np }));
  return { count: count, size: size, subnets: out };
};
// Do two networks overlap? Useful for VPN / Docker / Kubernetes address conflicts.
T.cidrOverlap = function (a, b) { var x = T.cidrInfo(a), y = T.cidrInfo(b); return x.netInt <= y.bcInt && y.netInt <= x.bcInt; };

/* IPv6 */
T.ip6Parse = function (s) {
  s = String(s).trim().replace(/^\[|\]$/g, '');
  var zone = '', zi = s.indexOf('%'); if (zi >= 0) { zone = s.slice(zi); s = s.slice(0, zi); }
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.indexOf(':') < 0) throw new Error('"' + s + '" is not a valid IPv6 address.');
  var v4 = null, m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { v4 = T.ip4Parse(m[2]); s = m[1] + (v4 >>> 16).toString(16) + ':' + (v4 & 0xffff).toString(16); }
  var dbl = s.split('::');
  if (dbl.length > 2) throw new Error('"::" may appear only once in an IPv6 address.');
  function groups(x) { return x === '' ? [] : x.split(':'); }
  var head = groups(dbl[0]), tail = dbl.length === 2 ? groups(dbl[1]) : [];
  var all = head.concat(tail);
  if (all.some(function (g) { return !/^[0-9a-fA-F]{1,4}$/.test(g); })) throw new Error('Each IPv6 group must be 1-4 hex digits.');
  var missing = 8 - all.length;
  if (dbl.length === 2 ? missing < 1 : missing !== 0) throw new Error(dbl.length === 2 ? 'Too many groups for "::" to stand for.' : 'An IPv6 address needs 8 groups (or "::" for a run of zeros).');
  var full = head.concat(new Array(dbl.length === 2 ? missing : 0).fill('0'), tail), n = BigInt(0);
  full.forEach(function (g) { n = (n << BigInt(16)) | BigInt(parseInt(g, 16)); });
  return { n: n, zone: zone };
};
function ip6Groups(n) { var g = []; for (var k = 7; k >= 0; k--) g.push(Number((n >> BigInt(16 * k)) & BigInt(0xffff))); return g; }
T.ip6Expand = function (n) { return ip6Groups(n).map(function (g) { return ('000' + g.toString(16)).slice(-4); }).join(':'); };
T.ip6Compress = function (n) {
  var g = ip6Groups(n), bs = -1, bl = 0;
  for (var k = 0; k < 8;) { if (g[k] === 0) { var j = k; while (j < 8 && g[j] === 0) j++; if (j - k > bl) { bs = k; bl = j - k; } k = j; } else k++; }
  var h = g.map(function (x) { return x.toString(16); });
  if (bl < 2) return h.join(':');
  return h.slice(0, bs).join(':') + '::' + h.slice(bs + bl).join(':');
};
function ip6Type(n) {
  var R = [['::1', 128, 'Loopback'], ['::', 128, 'Unspecified'], ['::ffff:0:0', 96, 'IPv4-mapped'], ['64:ff9b::', 96, 'IPv4/IPv6 translation (NAT64)'], ['2001:db8::', 32, 'Documentation'],
    ['2001::', 32, 'Teredo'], ['2002::', 16, '6to4'], ['fe80::', 10, 'Link-local'], ['fc00::', 7, 'Unique local (ULA, private)'], ['ff00::', 8, 'Multicast'], ['2000::', 3, 'Global unicast']];
  for (var k = 0; k < R.length; k++) { var b = T.ip6Parse(R[k][0]).n, sh = BigInt(128 - R[k][1]); if ((n >> sh) === (b >> sh)) return R[k][2]; }
  return 'Reserved';
}
T.ip6Info = function (s) {
  s = String(s).trim();
  var m = /^(.*?)(?:\/(\d{1,3}))?$/.exec(s), a = T.ip6Parse(m[1]), p = m[2] === undefined ? 128 : +m[2];
  if (p > 128) throw new Error('The IPv6 prefix length must be between 0 and 128.');
  var ALL = (BigInt(1) << BigInt(128)) - BigInt(1), host = p === 128 ? BigInt(0) : (BigInt(1) << BigInt(128 - p)) - BigInt(1), net = a.n & (ALL ^ host), last = net | host;
  var total = BigInt(1) << BigInt(128 - p);
  return { address: T.ip6Compress(a.n) + a.zone, expanded: T.ip6Expand(a.n), prefix: p, network: T.ip6Compress(net) + '/' + p, first: T.ip6Compress(net), last: T.ip6Compress(last),
    firstExpanded: T.ip6Expand(net), lastExpanded: T.ip6Expand(last), total: total.toString(), totalPow: '2^' + (128 - p), type: ip6Type(a.n), n: a.n,
    hostBitsSet: (a.n & host) !== BigInt(0),
    ptr: T.ip6Expand(a.n).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa' };
};
/* ---------------- docker run -> compose ---------------- */
// value-taking flags: flag -> compose handler name
var DR_VAL = { '-p': 'ports', '--publish': 'ports', '-v': 'volumes', '--volume': 'volumes', '--mount': 'mount', '-e': 'env', '--env': 'env', '--env-file': 'env_file',
  '--name': 'name', '--restart': 'restart', '--network': 'network', '--net': 'network', '--network-alias': 'alias', '--net-alias': 'alias', '-w': 'working_dir',
  '--workdir': 'working_dir', '-u': 'user', '--user': 'user', '--entrypoint': 'entrypoint', '-h': 'hostname', '--hostname': 'hostname', '--add-host': 'extra_hosts',
  '--dns': 'dns', '--dns-search': 'dns_search', '-l': 'labels', '--label': 'labels', '--cpus': 'cpus', '-m': 'mem_limit', '--memory': 'mem_limit',
  '--memory-reservation': 'mem_reservation', '--memory-swap': 'memswap_limit', '--shm-size': 'shm_size', '--cap-add': 'cap_add', '--cap-drop': 'cap_drop',
  '--device': 'devices', '--log-driver': 'log_driver', '--log-opt': 'log_opt', '--ulimit': 'ulimits', '--sysctl': 'sysctls', '--tmpfs': 'tmpfs', '--platform': 'platform',
  '--pull': 'pull_policy', '--health-cmd': 'hc_test', '--health-interval': 'hc_interval', '--health-retries': 'hc_retries', '--health-timeout': 'hc_timeout',
  '--health-start-period': 'hc_start_period', '--gpus': 'gpus', '--ipc': 'ipc', '--pid': 'pid', '--stop-signal': 'stop_signal', '--stop-timeout': 'stop_grace_period',
  '--security-opt': 'security_opt', '--expose': 'expose', '--link': 'links', '--group-add': 'group_add', '--runtime': 'runtime', '--mac-address': 'mac_address',
  '--ip': 'ip', '--ip6': 'ip6', '--userns': 'userns_mode', '--uts': 'uts', '--cgroup-parent': 'cgroup_parent', '--cpu-shares': 'cpu_shares', '-c': 'cpu_shares',
  '--cpuset-cpus': 'cpuset', '--pids-limit': 'pids_limit', '--oom-score-adj': 'oom_score_adj', '--volumes-from': 'volumes_from', '--label-file': 'label_file',
  '--attach': 'ignore', '-a': 'ignore', '--cidfile': 'ignore', '--detach-keys': 'ignore', '--storage-opt': 'storage_opt', '--device-cgroup-rule': 'device_cgroup_rules',
  '--isolation': 'isolation', '--domainname': 'domainname', '--cgroupns': 'cgroup', '--blkio-weight': 'blkio', '--cpu-period': 'cpu_period', '--cpu-quota': 'cpu_quota' };
var DR_BOOL = { '-d': 'detach', '--detach': 'detach', '-i': 'stdin_open', '--interactive': 'stdin_open', '-t': 'tty', '--tty': 'tty', '--rm': 'rm', '--privileged': 'privileged',
  '--init': 'init', '--read-only': 'read_only', '-P': 'publish_all', '--publish-all': 'publish_all', '--no-healthcheck': 'no_healthcheck', '-q': 'ignore', '--quiet': 'ignore',
  '--sig-proxy': 'ignore', '--oom-kill-disable': 'oom_kill_disable' };

function yq(s) {
  s = String(s);
  if (s === '') return '""';
  if (/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(s) || /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^0[xo][0-9a-f]+$/i.test(s) || /^[\d:]+$/.test(s)) return JSON.stringify(s);
  if (/^[A-Za-z0-9_.\/~$][A-Za-z0-9_.\/~$@%+=:-]*$/.test(s) && !/:$/.test(s)) return s;
  return JSON.stringify(s);
}
T.yamlQuote = yq;
function yflow(arr) { return '[' + arr.map(function (x) { return JSON.stringify(x); }).join(', ') + ']'; }
function drServiceName(name, image) {
  var s = name || (image || 'app').replace(/@.*$/, '').split('/').pop().replace(/:.*$/, '');
  s = s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+|[-.]+$/g, '');
  return s || 'app';
}
function drDur(v) { return /^\d+$/.test(v) ? v + 's' : v; }

T.dockerRunParse = function (text) {
  var words = T.shellSplit(String(text).trim().replace(/^\$\s+/, '')), cmds = [], cur = null, warnings = [];
  for (var k = 0; k < words.length; k++) {
    var w = words[k];
    if (typeof w !== 'string') { if (cur) { cmds.push(cur); cur = null; } continue; }
    if (cur) { cur.push(w); continue; }
    if (/(^|\/)(docker|podman)(\.exe)?$/.test(w) || w === 'sudo') {
      var j = k + (w === 'sudo' ? 1 : 0);
      if (w === 'sudo' && !/docker|podman/.test(words[j] || '')) continue;
      var a1 = words[j + 1], a2 = words[j + 2];
      if (a1 === 'run') { cur = []; k = j + 1; } else if (a1 === 'container' && (a2 === 'run' || a2 === 'create')) { cur = []; k = j + 2; } else if (a1 === 'create') { cur = []; k = j + 1; }
    }
  }
  if (cur) cmds.push(cur);
  if (!cmds.length) throw new Error('No "docker run" command found. Paste a command like: docker run -d -p 8080:80 nginx');
  var services = cmds.map(function (args) { return drParseOne(args, warnings); });
  return { services: services, warnings: warnings };
};

function drParseOne(args, warnings) {
  var s = { opts: {}, lists: {}, image: null, command: [] };
  function addList(key, v) { (s.lists[key] = s.lists[key] || []).push(v); }
  for (var i = 0; i < args.length; i++) {
    var a = args[i], flag = null, val = null;
    if (a === '--') { i++; a = args[i]; if (a === undefined) break; }
    else if (/^--[a-z]/.test(a)) {
      var eq = a.indexOf('=');
      flag = eq > 0 ? a.slice(0, eq) : a;
      if (DR_VAL[flag]) { val = eq > 0 ? a.slice(eq + 1) : args[++i]; if (val === undefined) throw new Error(flag + ' needs a value.'); }
      else if (DR_BOOL[flag]) { val = eq > 0 ? a.slice(eq + 1) : 'true'; if (/^false$/i.test(val)) continue; }
      else { warnings.push('Unknown option ' + flag + ' was skipped.'); if (eq < 0 && args[i + 1] && args[i + 1].charAt(0) !== '-' && false) i++; continue; }
      drApply(s, flag, val, warnings, addList); continue;
    } else if (/^-[A-Za-z]/.test(a)) {
      for (var j = 1; j < a.length; j++) {
        var f = '-' + a[j];
        if (DR_VAL[f]) { val = a.slice(j + 1).replace(/^=/, '') || args[++i]; if (val === undefined) throw new Error(f + ' needs a value.'); drApply(s, f, val, warnings, addList); break; }
        if (DR_BOOL[f]) { drApply(s, f, 'true', warnings, addList); continue; }
        warnings.push('Unknown option ' + f + ' was skipped.');
      }
      continue;
    }
    s.image = a; s.command = args.slice(i + 1); break;
  }
  if (!s.image) throw new Error('No image name found after the options.');
  return s;
}

function drApply(s, flag, v, warnings, addList) {
  var h = DR_VAL[flag] || DR_BOOL[flag], o = s.opts;
  switch (h) {
    case 'ports': case 'volumes': case 'env': case 'env_file': case 'extra_hosts': case 'dns': case 'dns_search': case 'labels': case 'cap_add': case 'cap_drop': case 'devices':
    case 'log_opt': case 'ulimits': case 'sysctls': case 'tmpfs': case 'security_opt': case 'expose': case 'links': case 'group_add': case 'alias': case 'mount':
    case 'volumes_from': case 'storage_opt': case 'device_cgroup_rules': case 'label_file': case 'network':
      addList(h, v); break;
    case 'ignore': break;
    default: o[h] = v;
  }
}

T.dockerRunToCompose = function (text) {
  var p = T.dockerRunParse(text), W = p.warnings.slice(), L = ['services:'], topNet = {}, topVol = {}, names = {};
  var dollar = false;
  function esc$(x) { if (/\$/.test(x)) { dollar = true; } return x; }
  p.services.forEach(function (s) {
    var o = s.opts, li = s.lists, name = drServiceName(o.name, s.image), base = name, n = 2;
    while (names[name]) name = base + '-' + n++;
    names[name] = 1;
    var S = [];
    function kv(k, v) { S.push('    ' + k + ': ' + v); }
    function list(k, arr, q) { if (!arr || !arr.length) return; S.push('    ' + k + ':'); arr.forEach(function (x) { S.push('      - ' + (q ? JSON.stringify(x) : yq(x))); }); }
    kv('image', yq(s.image));
    if (o.name) kv('container_name', yq(o.name));
    if (o.platform) kv('platform', yq(o.platform));
    if (o.pull_policy) kv('pull_policy', yq(o.pull_policy === 'missing' ? 'missing' : o.pull_policy));
    if (o.restart) kv('restart', yq(o.restart));
    if (o.entrypoint !== undefined) kv('entrypoint', o.entrypoint === '' ? '[""]' : yflow([o.entrypoint]));
    if (s.command.length) kv('command', yflow(s.command.map(function (c) { return /\$/.test(c) ? (dollar = true, c.replace(/\$/g, '$$$$')) : c; })));
    if (o.working_dir) kv('working_dir', yq(o.working_dir));
    if (o.user) kv('user', JSON.stringify(o.user));
    if (o.hostname) kv('hostname', yq(o.hostname));
    if (o.domainname) kv('domainname', yq(o.domainname));
    if (li.ports) list('ports', li.ports, true);
    if (li.expose) list('expose', li.expose, true);
    // volumes (short syntax) and --mount (long syntax)
    var vols = (li.volumes || []).map(function (v) {
      var parts = v.split(':'), src = parts[0];
      if (/^[A-Za-z]$/.test(src) && parts.length > 2) { src = parts[0] + ':' + parts[1]; parts = [src].concat(parts.slice(2)); } // Windows C:\path
      if (parts.length === 1) return { s: v, note: 'anonymous' };
      var src2 = src.replace(/^(\$\(pwd\)|\$\{?PWD\}?|`pwd`|%cd%|\$\{pwd\})(?=\/|\\|$)/, '.');
      if (src2 !== src) { if (src2 === '.') src2 = '.'; parts[0] = src2; }
      if (!/^[.\/~$\\]|^[A-Za-z]:/.test(parts[0])) topVol[parts[0]] = 1;
      return { s: parts.join(':') };
    });
    var mounts = (li.mount || []).map(function (m) {
      var kvs = {}; m.split(',').forEach(function (x) { var e = x.indexOf('='); kvs[e < 0 ? x : x.slice(0, e)] = e < 0 ? 'true' : x.slice(e + 1); });
      return kvs;
    });
    if (vols.length || mounts.length) {
      S.push('    volumes:');
      vols.forEach(function (v) { S.push('      - ' + yq(v.s)); });
      mounts.forEach(function (m) {
        var type = m.type || 'volume', src = m.source || m.src, dst = m.target || m.destination || m.dst;
        if (src && type === 'bind') src = src.replace(/^(\$\(pwd\)|\$\{?PWD\}?|`pwd`)(?=\/|$)/, '.');
        S.push('      - type: ' + type);
        if (src) S.push('        source: ' + yq(src));
        if (dst) S.push('        target: ' + yq(dst));
        if (m.readonly || m.ro) S.push('        read_only: true');
        if (type === 'volume' && src) topVol[src] = 1;
        if (m['bind-propagation']) S.push('        bind:', '          propagation: ' + yq(m['bind-propagation']));
        if (m['volume-nocopy']) S.push('        volume:', '          nocopy: true');
        if (m['tmpfs-size']) S.push('        tmpfs:', '          size: ' + yq(m['tmpfs-size']));
      });
    }
    if (li.volumes_from) list('volumes_from', li.volumes_from);
    if (li.tmpfs) list('tmpfs', li.tmpfs);
    if (li.env) {
      S.push('    environment:');
      li.env.forEach(function (e) {
        var eqi = e.indexOf('=');
        if (eqi < 0) { S.push('      - ' + yq(e)); return; }
        var val = e.slice(eqi + 1);
        if (/\$/.test(val)) { dollar = true; val = val.replace(/\$/g, '$$$$'); }
        S.push('      ' + yq(e.slice(0, eqi)) + ': ' + yq(val));
      });
      // the "- KEY" form and "KEY: value" form can't be mixed in one block
      var block = S.slice(S.lastIndexOf('    environment:') + 1);
      if (block.some(function (l) { return /^      - /.test(l); }) && block.some(function (l) { return !/^      - /.test(l); })) {
        var start = S.lastIndexOf('    environment:') + 1;
        S.splice(start, block.length);
        li.env.forEach(function (e) { var eqi = e.indexOf('='); var x = eqi < 0 ? e : e.slice(0, eqi + 1) + e.slice(eqi + 1).replace(/\$/g, '$$$$'); S.push('      - ' + yq(x)); });
      }
    }
    if (li.env_file) list('env_file', li.env_file);
    // networking
    var nets = li.network || [];
    var mode = nets.filter(function (x) { return /^(host|none|bridge|default)$|^(container|service|ns):/.test(x); })[0];
    var custom = nets.filter(function (x) { return x !== mode; }).map(function (x) { return x.split(',')[0].replace(/^name=/, ''); });
    if (mode && mode !== 'bridge' && mode !== 'default') kv('network_mode', JSON.stringify(mode.replace(/^container:/, 'container:')));
    if (mode === 'bridge') W.push('--network bridge is Docker\'s default network: Compose instead puts services on a project network named <project>_default, where they can reach each other by service name.');
    if (custom.length) {
      if (li.alias || o.ip || o.ip6) {
        S.push('    networks:');
        custom.forEach(function (nn, idx) {
          S.push('      ' + yq(nn) + ':');
          if (idx === 0 && li.alias) { S.push('        aliases:'); li.alias.forEach(function (a) { S.push('          - ' + yq(a)); }); }
          if (idx === 0 && o.ip) S.push('        ipv4_address: ' + yq(o.ip));
          if (idx === 0 && o.ip6) S.push('        ipv6_address: ' + yq(o.ip6));
        });
      } else list('networks', custom);
      custom.forEach(function (nn) { topNet[nn] = 1; });
    } else if (li.alias || o.ip) W.push('--network-alias / --ip only work on a user-defined network: add one under "networks:".');
    if (li.links) { list('links', li.links); W.push('--link is legacy: on a Compose network every service can already reach the others by service name.'); }
    if (li.extra_hosts) list('extra_hosts', li.extra_hosts.map(function (x) { return x.replace(/^([^:]+):/, '$1:'); }), true);
    if (li.dns) list('dns', li.dns);
    if (li.dns_search) list('dns_search', li.dns_search);
    if (o.mac_address) kv('mac_address', JSON.stringify(o.mac_address));
    if (o.stdin_open) kv('stdin_open', 'true');
    if (o.tty) kv('tty', 'true');
    if (o.privileged) kv('privileged', 'true');
    if (o.init) kv('init', 'true');
    if (o.read_only) kv('read_only', 'true');
    if (o.ipc) kv('ipc', yq(o.ipc));
    if (o.pid) kv('pid', yq(o.pid));
    if (o.uts) kv('uts', yq(o.uts));
    if (o.userns_mode) kv('userns_mode', yq(o.userns_mode));
    if (o.cgroup) kv('cgroup', yq(o.cgroup));
    if (o.cgroup_parent) kv('cgroup_parent', yq(o.cgroup_parent));
    if (o.isolation) kv('isolation', yq(o.isolation));
    if (o.runtime) kv('runtime', yq(o.runtime));
    if (li.cap_add) list('cap_add', li.cap_add);
    if (li.cap_drop) list('cap_drop', li.cap_drop);
    if (li.security_opt) list('security_opt', li.security_opt);
    if (li.devices) list('devices', li.devices);
    if (li.device_cgroup_rules) list('device_cgroup_rules', li.device_cgroup_rules, true);
    if (li.group_add) list('group_add', li.group_add, true);
    if (o.cpus) kv('cpus', JSON.stringify(o.cpus).replace(/"/g, '') === o.cpus && /^\d+(\.\d+)?$/.test(o.cpus) ? o.cpus : yq(o.cpus));
    if (o.cpu_shares) kv('cpu_shares', /^\d+$/.test(o.cpu_shares) ? o.cpu_shares : yq(o.cpu_shares));
    if (o.cpu_period) kv('cpu_period', yq(o.cpu_period));
    if (o.cpu_quota) kv('cpu_quota', yq(o.cpu_quota));
    if (o.cpuset) kv('cpuset', JSON.stringify(o.cpuset));
    if (o.mem_limit) kv('mem_limit', yq(o.mem_limit));
    if (o.mem_reservation) kv('mem_reservation', yq(o.mem_reservation));
    if (o.memswap_limit) kv('memswap_limit', yq(o.memswap_limit));
    if (o.shm_size) kv('shm_size', yq(o.shm_size));
    if (o.pids_limit) kv('pids_limit', /^-?\d+$/.test(o.pids_limit) ? o.pids_limit : yq(o.pids_limit));
    if (o.oom_score_adj) kv('oom_score_adj', o.oom_score_adj);
    if (o.oom_kill_disable) kv('oom_kill_disable', 'true');
    if (o.blkio) S.push('    blkio_config:', '      weight: ' + o.blkio);
    if (li.ulimits) {
      S.push('    ulimits:');
      li.ulimits.forEach(function (u) {
        var m = /^([a-z]+)=(-?\d+)(?::(-?\d+))?$/.exec(u);
        if (!m) { W.push('Could not convert --ulimit ' + u); return; }
        if (m[3] === undefined) S.push('      ' + m[1] + ': ' + m[2]);
        else S.push('      ' + m[1] + ':', '        soft: ' + m[2], '        hard: ' + m[3]);
      });
    }
    if (li.sysctls) { S.push('    sysctls:'); li.sysctls.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    if (li.storage_opt) { S.push('    storage_opt:'); li.storage_opt.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    if (li.labels) {
      S.push('    labels:');
      li.labels.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(e < 0 ? x : x.slice(0, e)) + ': ' + yq(e < 0 ? '' : x.slice(e + 1).replace(/\$/g, function () { dollar = true; return '$$'; }))); });
    }
    if (li.label_file) W.push('--label-file is not supported by Compose: copy the labels into "labels:".');
    if (o.log_driver || li.log_opt) {
      S.push('    logging:');
      if (o.log_driver) S.push('      driver: ' + yq(o.log_driver));
      if (li.log_opt) { S.push('      options:'); li.log_opt.forEach(function (x) { var e = x.indexOf('='); S.push('        ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    }
    if (o.no_healthcheck) S.push('    healthcheck:', '      disable: true');
    else if (o.hc_test || o.hc_interval || o.hc_retries || o.hc_timeout || o.hc_start_period) {
      S.push('    healthcheck:');
      if (o.hc_test) S.push('      test: ' + yflow(['CMD-SHELL', o.hc_test.replace(/\$/g, function () { dollar = true; return '$$'; })]));
      if (o.hc_interval) S.push('      interval: ' + yq(drDur(o.hc_interval)));
      if (o.hc_timeout) S.push('      timeout: ' + yq(drDur(o.hc_timeout)));
      if (o.hc_retries) S.push('      retries: ' + o.hc_retries);
      if (o.hc_start_period) S.push('      start_period: ' + yq(drDur(o.hc_start_period)));
    }
    if (o.stop_signal) kv('stop_signal', yq(o.stop_signal));
    if (o.stop_grace_period) kv('stop_grace_period', yq(drDur(o.stop_grace_period)));
    if (o.gpus) {
      var g = o.gpus.replace(/^"|"$/g, ''), cm = /^(all|\d+)$/.exec(g), dm = /device=([\d,]+)/.exec(g);
      S.push('    deploy:', '      resources:', '        reservations:', '          devices:', '            - driver: nvidia');
      if (dm) S.push('              device_ids: ' + yflow(dm[1].split(',')));
      else S.push('              count: ' + (cm ? cm[1] : 'all'));
      S.push('              capabilities: [gpu]');
    }
    if (o.rm) W.push('--rm has no Compose equivalent for services: "docker compose down" removes the containers. For one-off tasks use "docker compose run --rm ' + name + '".');
    if (o.detach) W.push('-d is not part of the file: start the stack in the background with "docker compose up -d".');
    if (o.publish_all) W.push('-P (publish all exposed ports to random host ports) has no direct Compose equivalent: list the ports under "ports:" (e.g. "- \\"80\\"" picks a random host port).');
    if (li.ports && li.ports.some(function (x) { return /^\d+:\d+$/.test(x) && +x.split(':')[1] < 60; })) W.push('Ports are written in quotes on purpose: unquoted values like 22:22 are read by YAML 1.1 parsers as base-60 numbers (22:22 becomes 1342).');
    L.push('  ' + name + ':');
    L.push.apply(L, S);
  });
  if (dollar) W.push('Every "$" in a value was doubled to "$$": Compose would otherwise treat it as a ${VARIABLE} to substitute from your shell or .env file.');
  var nk = Object.keys(topNet);
  if (nk.length) { L.push('', 'networks:'); nk.forEach(function (x) { L.push('  ' + yq(x) + ':', '    external: true'); }); W.push('The network' + (nk.length > 1 ? 's ' : ' ') + nk.join(', ') + ' marked "external: true" must already exist (docker network create ' + nk[0] + '). Remove "external: true" to let Compose create and manage it.'); }
  var vk = Object.keys(topVol);
  if (vk.length) { L.push('', 'volumes:'); vk.forEach(function (x) { L.push('  ' + yq(x) + ':'); }); W.push('Named volume' + (vk.length > 1 ? 's ' : ' ') + vk.join(', ') + ' will be created as <project>_' + vk[0] + '. To reuse the existing volume from docker run, add "external: true" under it.'); }
  W = W.filter(function (w, k) { return W.indexOf(w) === k; });
  return { yaml: L.join('\n') + '\n', warnings: W, count: p.services.length };
};
/* ---------------- SQL formatter ---------------- */
var SQL_KW = ('SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE BETWEEN EXISTS AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS NATURAL USING GROUP BY ORDER ' +
  'HAVING LIMIT OFFSET UNION ALL DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES DEFAULT ' +
  'CONSTRAINT CHECK DROP ALTER ADD COLUMN RENAME TO IF REPLACE CASE WHEN THEN ELSE END ASC DESC WITH RECURSIVE RETURNING CONFLICT DO NOTHING DUPLICATE ' +
  'INTERSECT EXCEPT MINUS OVER PARTITION WINDOW ROWS RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT ROW FETCH FIRST NEXT ONLY TRUE FALSE AUTO_INCREMENT ' +
  'AUTOINCREMENT CASCADE RESTRICT TRUNCATE TEMPORARY TEMP LATERAL APPLY FOR SHARE NULLS LAST BEGIN COMMIT ROLLBACK TRANSACTION GRANT REVOKE IGNORE ANY ' +
  'SOME INTERVAL COLLATE ESCAPE SIMILAR REGEXP RLIKE QUALIFY ENGINE CHARSET CHARACTER TOP MATERIALIZED SCHEMA DATABASE TRIGGER PROCEDURE FUNCTION RETURNS ' +
  'LANGUAGE FILTER WITHIN EXPLAIN ANALYZE SHOW DESCRIBE USE OF NO ACTION MODIFY CHANGE FIRST AFTER').split(' ');
var SQL_FN = ('COUNT SUM AVG MIN MAX COALESCE NULLIF IFNULL ISNULL NVL CAST CONVERT CONCAT CONCAT_WS SUBSTRING SUBSTR LOWER UPPER TRIM LTRIM RTRIM LENGTH ' +
  'CHAR_LENGTH ROUND FLOOR CEIL CEILING ABS NOW DATE_TRUNC DATE_FORMAT DATE_ADD DATE_SUB DATEADD DATEDIFF EXTRACT TO_CHAR TO_DATE TO_TIMESTAMP STRING_AGG ' +
  'GROUP_CONCAT ARRAY_AGG JSON_AGG JSONB_AGG JSON_EXTRACT JSON_OBJECT JSON_BUILD_OBJECT ROW_NUMBER RANK DENSE_RANK NTILE LAG LEAD FIRST_VALUE LAST_VALUE ' +
  'GREATEST LEAST POSITION REPLACE IIF UNNEST GENERATE_SERIES ' +
  'INT INTEGER BIGINT SMALLINT TINYINT MEDIUMINT DECIMAL NUMERIC FLOAT DOUBLE REAL VARCHAR NVARCHAR CHAR NCHAR TEXT BOOLEAN BOOL DATE TIME TIMESTAMP ' +
  'TIMESTAMPTZ DATETIME SERIAL BIGSERIAL UUID JSON JSONB BLOB BYTEA VARBINARY BINARY ENUM').split(' ');
var SQL_KWS = {}, SQL_FNS = {};
SQL_KW.forEach(function (k) { SQL_KWS[k] = 1; }); SQL_FN.forEach(function (k) { SQL_FNS[k] = 1; });
var SQL_PHRASES = ['CREATE OR REPLACE VIEW', 'CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE', 'CREATE UNIQUE INDEX', 'CREATE MATERIALIZED VIEW',
  'DROP TABLE IF EXISTS', 'ON DUPLICATE KEY UPDATE', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'INSERT IGNORE INTO', 'DO UPDATE SET',
  'GROUP BY', 'ORDER BY', 'PARTITION BY', 'UNION ALL', 'UNION DISTINCT', 'INSERT INTO', 'REPLACE INTO', 'DELETE FROM', 'LEFT JOIN', 'RIGHT JOIN',
  'FULL JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN', 'CROSS APPLY', 'OUTER APPLY', 'ON CONFLICT', 'CREATE TABLE', 'CREATE VIEW', 'CREATE INDEX',
  'ALTER TABLE', 'DROP TABLE', 'DROP VIEW', 'DROP INDEX', 'TRUNCATE TABLE', 'PRIMARY KEY', 'FOREIGN KEY', 'NOT NULL', 'IS NOT', 'NOT IN', 'NOT LIKE',
  'NOT EXISTS', 'NOT BETWEEN', 'ON DELETE', 'ON UPDATE', 'WITH RECURSIVE', 'SELECT DISTINCT', 'DO NOTHING', 'FETCH FIRST', 'FETCH NEXT', 'FOR UPDATE', 'FOR SHARE', 'UNION'
].map(function (p) { return p.split(' '); }).sort(function (a, b) { return b.length - a.length; });
var SQL_CLAUSE_BLOCK = { 'SELECT': 1, 'SELECT DISTINCT': 1, 'FROM': 1, 'WHERE': 1, 'GROUP BY': 1, 'ORDER BY': 1, 'HAVING': 1, 'SET': 1, 'VALUES': 1,
  'RETURNING': 1, 'WITH': 1, 'WITH RECURSIVE': 1, 'WINDOW': 1, 'ON DUPLICATE KEY UPDATE': 1, 'DO UPDATE SET': 1, 'QUALIFY': 1 };
var SQL_CLAUSE_INLINE = { 'LIMIT': 1, 'OFFSET': 1, 'INSERT INTO': 1, 'INSERT IGNORE INTO': 1, 'REPLACE INTO': 1, 'UPDATE': 1, 'DELETE FROM': 1, 'DELETE': 1,
  'CREATE TABLE': 1, 'CREATE TABLE IF NOT EXISTS': 1, 'CREATE TEMPORARY TABLE': 1, 'CREATE VIEW': 1, 'CREATE OR REPLACE VIEW': 1, 'CREATE MATERIALIZED VIEW': 1,
  'CREATE INDEX': 1, 'CREATE UNIQUE INDEX': 1, 'ALTER TABLE': 1, 'DROP TABLE': 1, 'DROP TABLE IF EXISTS': 1, 'DROP VIEW': 1, 'DROP INDEX': 1,
  'TRUNCATE TABLE': 1, 'ON CONFLICT': 1, 'FETCH FIRST': 1, 'FETCH NEXT': 1, 'FOR UPDATE': 1, 'FOR SHARE': 1, 'DO NOTHING': 1 };
var SQL_SETOP = { 'UNION': 1, 'UNION ALL': 1, 'UNION DISTINCT': 1, 'INTERSECT': 1, 'EXCEPT': 1, 'MINUS': 1 };
var SQL_COMMA_BREAK = { 'SELECT': 1, 'SELECT DISTINCT': 1, 'GROUP BY': 1, 'ORDER BY': 1, 'SET': 1, 'VALUES': 1, 'RETURNING': 1, 'WITH': 1,
  'WITH RECURSIVE': 1, '(columns)': 1, 'ON DUPLICATE KEY UPDATE': 1, 'DO UPDATE SET': 1, 'FROM': 1, 'WINDOW': 1 };

T.sqlTokenize = function (s) {
  var toks = [], i = 0, n = s.length, m;
  function push(type, v) { toks.push({ t: type, v: v }); }
  while (i < n) {
    var c = s[i], rest;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && s[i + 1] === '-' || c === '#' && /^#(\s|$)/.test(s.substr(i, 2))) { var e = s.indexOf('\n', i); if (e < 0) e = n; push('lc', s.slice(i, e).replace(/\s+$/, '')); i = e; continue; }
    if (c === '/' && s[i + 1] === '*') { var e2 = s.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; push('bc', s.slice(i, e2)); i = e2; continue; }
    if (c === "'" || ((c === 'N' || c === 'n' || c === 'E' || c === 'e' || c === 'X' || c === 'x' || c === 'B' || c === 'b') && s[i + 1] === "'" && !/[\w$]/.test(s[i - 1] || ''))) {
      var j = c === "'" ? i + 1 : i + 2;
      while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } j++; break; } j++; }
      if (j > n) j = n;
      push('str', s.slice(i, j)); i = j; continue;
    }
    if (c === '$' && (m = /^\$([A-Za-z_]\w*)?\$/.exec(s.slice(i)))) {
      var end = s.indexOf(m[0], i + m[0].length); end = end < 0 ? n : end + m[0].length;
      push('str', s.slice(i, end)); i = end; continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      var close = c === '[' ? ']' : c, k = i + 1;
      while (k < n) { if (s[k] === close) { if (s[k + 1] === close && c !== '[') { k += 2; continue; } k++; break; } k++; }
      push('id', s.slice(i, k)); i = k; continue;
    }
    rest = s.slice(i, i + 64);
    if ((m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest)) && !/[A-Za-z_]/.test(s[i + m[0].length] || '')) { push('num', m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_\u00c0-\uffff][\w$\u00c0-\uffff]*/.exec(rest))) { push('word', m[0]); i += m[0].length; continue; }
    if ((m = /^([@:]{1,2}[A-Za-z_][\w.]*|\$\d+|\?)/.exec(rest)) && !(c === ':' && s[i + 1] === ':' && toks.length && /^(word|id|str|num|close)$/.test(toks[toks.length - 1].t) && false)) {
      if (!(c === ':' && s[i + 1] === ':')) { push('word', m[0]); i += m[0].length; continue; }
    }
    if ((m = /^(::|->>|->|<=>|<>|<=|>=|!=|\|\||&&|<<|>>|[-+*\/%=<>!~^&|])/.exec(rest))) { push('op', m[0]); i += m[0].length; continue; }
    if (c === '(') { push('open', c); i++; continue; }
    if (c === ')') { push('close', c); i++; continue; }
    if (c === ',') { push('comma', c); i++; continue; }
    if (c === ';') { push('semi', c); i++; continue; }
    if (c === '.') { push('dot', c); i++; continue; }
    push('op', c); i++;
  }
  // merge multi-word keyword phrases
  var out = [];
  for (var a = 0; a < toks.length; a++) {
    var tk = toks[a];
    if (tk.t === 'word') {
      var U = tk.v.toUpperCase(), hit = null;
      for (var p = 0; p < SQL_PHRASES.length && !hit; p++) {
        var ph = SQL_PHRASES[p];
        if (ph[0] !== U || ph.length < 2) continue;
        var ok = true;
        for (var q = 1; q < ph.length; q++) { var nt = toks[a + q]; if (!nt || nt.t !== 'word' || nt.v.toUpperCase() !== ph[q]) { ok = false; break; } }
        if (ok) hit = ph;
      }
      if (hit) {
        out.push({ t: 'kw', v: toks.slice(a, a + hit.length).map(function (x) { return x.v; }).join(' '), u: hit.join(' ') });
        a += hit.length - 1; continue;
      }
      if (SQL_KWS[U] && toks[a - 1] && toks[a - 1].t === 'dot') { out.push(tk); continue; }
      if (SQL_KWS[U] && !(SQL_FNS[U] && toks[a + 1] && toks[a + 1].t === 'open')) { out.push({ t: 'kw', v: tk.v, u: U }); continue; }
      if (SQL_FNS[U]) { out.push({ t: 'fn', v: tk.v, u: U }); continue; }
    }
    out.push(tk);
  }
  return out;
};

function sqlCase(tk, mode) {
  if (tk.t !== 'kw' && tk.t !== 'fn') return tk.v;
  return mode === 'upper' ? tk.u : mode === 'lower' ? tk.u.toLowerCase() : tk.v;
}

T.sqlMinify = function (sql, opts) {
  opts = opts || {};
  var toks = T.sqlTokenize(sql).filter(function (t) { return t.t !== 'lc' && t.t !== 'bc'; }), out = '', prev = null;
  toks.forEach(function (tk) {
    var v = sqlCase(tk, opts.keywordCase || 'preserve');
    if (prev) {
      var tight = /^(open|close|comma|semi|dot)$/.test(tk.t) || /^(open|comma|semi|dot)$/.test(prev.t) || (tk.t === 'op' && prev.t !== 'op') || (prev.t === 'op' && tk.t !== 'op');
      if (tk.t === 'open' && prev.t === 'kw') tight = false;
      if (prev.t === 'close' && /^(kw|word|fn|num|str|id)$/.test(tk.t)) tight = false;
      if (prev.t === 'semi') tight = false;
      if (!tight) out += ' ';
    }
    out += v; prev = tk;
  });
  return out;
};

T.sqlFormat = function (sql, opts) {
  opts = opts || {};
  var unit = opts.indent === 'tab' ? '\t' : ' '.repeat(opts.indent === undefined ? 2 : +opts.indent);
  var mode = opts.keywordCase || 'upper';
  var toks = T.sqlTokenize(sql);
  var lines = [], cur = '', curInd = 0, lineInd = 0, level = 0, clause = null, stack = [], between = false, prev = null, forceNL = false;
  function nl(ind) { if (cur.trim()) lines.push(cur.replace(/\s+$/, '')); cur = unit.repeat(Math.max(0, ind)); curInd = lineInd = Math.max(0, ind); prev = null; forceNL = false; }
  function top() { return stack[stack.length - 1]; }
  function atClause() { var t = top(); return !t || t.type === 'block'; }
  function inlineDepth() { var d = 0; for (var k = stack.length - 1; k >= 0 && stack[k].type !== 'block'; k--) if (stack[k].type === 'inline') d++; return d; }
  function write(tk, v) {
    if (forceNL) nl(curInd);
    var sp = true;
    if (!prev) sp = false;
    else if (/^(comma|semi|close|dot)$/.test(tk.t)) sp = false;
    else if (prev.t === 'open' || prev.t === 'dot') sp = false;
    else if (tk.t === 'op' && tk.v === '::' || prev.t === 'op' && prev.v === '::') sp = false;
    else if (prev.unary) sp = false;
    else if (tk.t === 'open' && (prev.t === 'fn' || prev.t === 'word' || prev.t === 'id') && !(prev.t !== 'fn' && /^(INSERT|REPLACE|CREATE|INTO)/.test(clause || '') && !inlineDepth())) sp = false;
    cur += (sp ? ' ' : '') + v;
    prev = tk;
  }
  for (var i = 0; i < toks.length; i++) {
    var tk = toks[i], v = sqlCase(tk, mode), U = tk.u || '', nx = toks[i + 1];
    if (tk.t === 'lc') { if (prev) cur += ' ' + v; else cur += v; prev = tk; forceNL = true; continue; }
    if (tk.t === 'semi') {
      write(tk, ';'); stack = []; level = 0; clause = null; between = false;
      if (i < toks.length - 1) { nl(0); lines.push(''); }
      continue;
    }
    if (tk.t === 'kw' && atClause()) {
      if (SQL_CLAUSE_BLOCK[U]) { nl(level); write(tk, v); nl(level + 1); clause = U; between = false; continue; }
      if (SQL_CLAUSE_INLINE[U]) { nl(level); write(tk, v); curInd = level + 1; clause = U; continue; }
      if (SQL_SETOP[U]) { nl(level); write(tk, v); nl(level); clause = null; continue; }
      if (/JOIN$|APPLY$/.test(U)) { nl(level + 1); write(tk, v); curInd = level + 2; continue; }
      if ((U === 'AND' || U === 'OR') && !between && clause && /^(WHERE|HAVING|FROM|QUALIFY|ON CONFLICT|DELETE FROM|UPDATE)$/.test(clause)) {
        nl(clause === 'FROM' ? level + 2 : level + 1); write(tk, v); continue;
      }
    }
    if (tk.t === 'kw' && (U === 'BETWEEN' || U === 'NOT BETWEEN')) { between = true; write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'AND' && between) { between = false; write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'CASE') { write(tk, v); stack.push({ type: 'case', base: lineInd }); continue; }
    if (tk.t === 'kw' && (U === 'WHEN' || U === 'ELSE') && top() && top().type === 'case') { nl(top().base + 1); write(tk, v); continue; }
    if (tk.t === 'kw' && U === 'END' && top() && top().type === 'case') { var cs = stack.pop(); nl(cs.base); write(tk, v); continue; }
    if (tk.t === 'open') {
      var la = nx, isSub = la && la.t === 'kw' && /^(SELECT|SELECT DISTINCT|WITH|WITH RECURSIVE|VALUES)$/.test(la.u) && !(la.u === 'VALUES' && true);
      var isCols = !isSub && atClause() && clause && /^CREATE (TEMPORARY )?TABLE/.test(clause) && !stack.some(function (s) { return s.type === 'inline'; }) && prev && prev.t !== 'fn';
      if (isSub || isCols) {
        write(tk, '(');
        stack.push({ type: 'block', level: level, clause: clause, ind: lineInd });
        level = lineInd + 1; clause = isCols ? '(columns)' : null; nl(level);
        continue;
      }
      write(tk, '('); stack.push({ type: 'inline' }); continue;
    }
    if (tk.t === 'close') {
      while (top() && top().type === 'case') stack.pop();
      var o = stack.pop();
      if (o && o.type === 'block') { nl(o.ind); write(tk, ')'); level = o.level; clause = o.clause; curInd = o.ind; continue; }
      write(tk, ')'); continue;
    }
    if (tk.t === 'comma') {
      write(tk, ',');
      if (atClause() && clause && SQL_COMMA_BREAK[clause]) nl(clause === '(columns)' ? level : level + 1);
      continue;
    }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+') && (!prev || /^(op|open|comma|kw)$/.test(prev.t)) && !(prev && prev.t === 'kw' && /^(END|NULL|TRUE|FALSE)$/.test(prev.u))) {
      write(tk, v); prev = { t: 'op', v: tk.v, unary: true }; continue;
    }
    write(tk, v);
  }
  nl(0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
/* ---------------- Shell words (shared by cURL and docker run converters) ---------------- */
// Splits a POSIX shell command line into words. Handles '...', "...", $'...', backslash escapes and
// line continuations (\ , ^ and ` at end of line). Operators (&&, ||, ;, |, newline) become {op: '...'}.
T.shellSplit = function (s) {
  s = String(s).replace(/\r\n?/g, '\n').replace(/[ \t]*(\\|\^|`)\n/g, ' ');
  var out = [], i = 0, n = s.length, w = null;
  function add(ch) { w = (w === null ? '' : w) + ch; }
  function end() { if (w !== null) { out.push(w); w = null; } }
  while (i < n) {
    var c = s[i];
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (c === '\n' || c === ';' || c === '&' && s[i + 1] === '&' || c === '|') {
      end();
      var op = c === '\n' ? '\n' : c === ';' ? ';' : (s[i + 1] === c ? c + c : c);
      out.push({ op: op }); i += op.length === 2 ? 2 : 1; continue;
    }
    if (c === '#' && w === null) { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '\\') { if (i + 1 < n) add(s[i + 1]); i += 2; continue; }
    if (c === "'") { var e = s.indexOf("'", i + 1); if (e < 0) e = n; add(s.slice(i + 1, e)); i = e + 1; continue; }
    if (c === '$' && s[i + 1] === "'") {
      i += 2; var buf = '';
      while (i < n && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < n) {
          var x = s[i + 1], m;
          var map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
          if (map[x] !== undefined) { buf += map[x]; i += 2; }
          else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(i + 1)))) { buf += String.fromCharCode(parseInt(m[1], 16)); i += 1 + m[0].length; }
          else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(s.slice(i + 1))) || (m = /^U([0-9a-fA-F]{1,8})/.exec(s.slice(i + 1)))) { buf += String.fromCodePoint(parseInt(m[1], 16)); i += 1 + m[0].length; }
          else if ((m = /^[0-7]{1,3}/.exec(s.slice(i + 1)))) { buf += String.fromCharCode(parseInt(m[0], 8)); i += 1 + m[0].length; }
          else { buf += '\\' + x; i += 2; }
        } else buf += s[i++];
      }
      // $'...' strings may contain UTF-8 bytes written as \xHH: decode them
      if (/[\x80-\xff]/.test(buf) && !/[^\x00-\xff]/.test(buf)) { try { buf = decodeURIComponent(escape(buf)); } catch (er) { /* keep */ } }
      add(buf); i++; continue;
    }
    if (c === '"') {
      i++; var b2 = '';
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n && '$`"\\\n'.indexOf(s[i + 1]) >= 0) { if (s[i + 1] !== '\n') b2 += s[i + 1]; i += 2; }
        else b2 += s[i++];
      }
      add(b2); i++; continue;
    }
    add(c); i++;
  }
  end();
  return out;
};

/* ---------------- cURL to code ---------------- */
var CURL_VAL = { '-X': 'request', '--request': 'request', '-H': 'header', '--header': 'header', '-d': 'data', '--data': 'data', '--data-ascii': 'data',
  '--data-raw': 'data-raw', '--data-binary': 'data-binary', '--data-urlencode': 'data-urlencode', '--json': 'json', '-u': 'user', '--user': 'user',
  '-F': 'form', '--form': 'form', '--form-string': 'form-string', '-b': 'cookie', '--cookie': 'cookie', '-A': 'user-agent', '--user-agent': 'user-agent',
  '-e': 'referer', '--referer': 'referer', '--url': 'url', '-m': 'max-time', '--max-time': 'max-time', '--connect-timeout': 'connect-timeout',
  '-x': 'proxy', '--proxy': 'proxy', '-o': 'output', '--output': 'output', '-w': 'write-out', '--write-out': 'write-out', '-c': 'cookie-jar',
  '--cookie-jar': 'cookie-jar', '--retry': 'retry', '--cacert': 'cacert', '-E': 'cert', '--cert': 'cert', '--key': 'key', '-T': 'upload-file',
  '--upload-file': 'upload-file', '--oauth2-bearer': 'bearer', '-r': 'range', '--range': 'range', '--resolve': 'resolve', '--max-redirs': 'max-redirs',
  '-K': 'config', '--config': 'config', '--aws-sigv4': 'aws', '--proxy-user': 'proxy-user', '-U': 'proxy-user', '--interface': 'interface',
  '--limit-rate': 'limit-rate', '--retry-delay': 'retry-delay', '--retry-max-time': 'retry-max-time', '-D': 'dump-header', '--dump-header': 'dump-header',
  '--trace': 'trace', '--trace-ascii': 'trace', '--stderr': 'stderr', '-Y': 'skip', '-y': 'skip', '-z': 'skip', '--expect100-timeout': 'skip' };
var CURL_BOOL = { '-L': 'location', '--location': 'location', '-k': 'insecure', '--insecure': 'insecure', '--compressed': 'compressed', '-G': 'get', '--get': 'get',
  '-I': 'head', '--head': 'head', '-s': 1, '--silent': 1, '-S': 1, '--show-error': 1, '-v': 1, '--verbose': 1, '-i': 1, '--include': 1, '-f': 'fail',
  '--fail': 'fail', '--fail-with-body': 'fail', '-O': 'remote-name', '--remote-name': 'remote-name', '-#': 1, '--progress-bar': 1, '-N': 1, '--no-buffer': 1,
  '--http1.1': 1, '--http2': 1, '--http1.0': 1, '--http2-prior-knowledge': 1, '--http3': 1, '-4': 1, '-6': 1, '--ipv4': 1, '--ipv6': 1, '-n': 1, '--netrc': 1,
  '--location-trusted': 'location', '-g': 1, '--globoff': 1, '-q': 1, '--disable': 1, '--no-progress-meter': 1, '--digest': 'digest', '--basic': 1,
  '--ntlm': 'ntlm', '--negotiate': 'ntlm', '-j': 1, '--junk-session-cookies': 1, '--tlsv1.2': 1, '--tlsv1.3': 1, '--path-as-is': 1, '-Z': 1, '--parallel': 1 };

function curlUrlencode(s) { return encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
function hdrFind(h, name) { name = name.toLowerCase(); for (var k = 0; k < h.length; k++) if (h[k][0].toLowerCase() === name) return k; return -1; }

T.curlParse = function (text) {
  var words = T.shellSplit(String(text).trim().replace(/^\$\s+/, '')), r = { method: null, url: null, headers: [], data: [], form: [], auth: null, warnings: [],
    insecure: false, follow: false, compressed: false, get: false, head: false, timeout: null, proxy: null, files: [], digest: false };
  var k = 0;
  while (k < words.length && (typeof words[k] !== 'string' || !/(^|\/)curl(\.exe)?$/i.test(words[k]))) k++;
  if (k >= words.length) { if (typeof words[0] === 'string' && /^(https?|ftp):\/\//i.test(words[0])) k = -1; else throw new Error('No curl command found: paste a command that starts with "curl".'); }
  var rest = [];
  for (k = k + 1; k < words.length; k++) {
    if (typeof words[k] !== 'string') {
      if (words[k].op === '\n' && rest.length && !words.slice(k + 1).some(function (x) { return typeof x === 'string'; })) break;
      if (words[k].op === '\n') { r.warnings.push('The command spans several lines without a trailing "\\": only the first line was used.'); break; }
      r.warnings.push('Ignored everything after "' + words[k].op + '" (only the curl command itself is converted).'); break;
    }
    rest.push(words[k]);
  }
  var endOpts = false;
  for (var i = 0; i < rest.length; i++) {
    var a = rest[i], opt = null, val = null;
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && /^--[a-z0-9]/i.test(a)) {
      var eq = null;
      if (CURL_VAL[a]) opt = a;
      else if (CURL_BOOL[a]) opt = a;
      else if (/^--no-/.test(a)) { if (a === '--no-location') r.follow = false; continue; }
      else { r.warnings.push('Unknown option ' + a + ' was ignored.'); continue; }
      if (CURL_VAL[opt]) { val = rest[++i]; if (val === undefined) throw new Error('Option ' + opt + ' needs a value.'); }
    } else if (!endOpts && /^-[^-]/.test(a) && a.length > 1) {
      // short options may be combined (-sSL) and values may be attached (-XPOST, -HAccept:x)
      for (var j = 1; j < a.length; j++) {
        var f = '-' + a[j];
        if (CURL_VAL[f]) { val = a.slice(j + 1) || rest[++i]; if (val === undefined) throw new Error('Option ' + f + ' needs a value.'); opt = f; break; }
        if (CURL_BOOL[f]) { if (j < a.length - 1) applyCurl(r, f, null); else opt = f; continue; }
        r.warnings.push('Unknown option ' + f + ' was ignored.');
      }
      if (!opt) continue;
    } else {
      if (!r.url) r.url = a; else r.warnings.push('Extra URL "' + a + '" ignored (only the first URL is converted).');
      continue;
    }
    applyCurl(r, opt, val);
  }
  if (!r.url) throw new Error('No URL found in the curl command.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(r.url)) r.url = 'http://' + r.url;
  // body
  var body = null;
  if (r.data.length) body = r.data.join('&');
  if (r.get && body !== null) { r.url += (r.url.indexOf('?') >= 0 ? '&' : '?') + body; body = null; }
  r.body = body;
  if (!r.method) r.method = r.head ? 'HEAD' : (r.get ? 'GET' : (body !== null || r.form.length || r.uploadFile ? (r.uploadFile && !r.data.length ? 'PUT' : 'POST') : 'GET'));
  r.method = r.method.toUpperCase();
  var ct = hdrFind(r.headers, 'content-type');
  if (body !== null && !r.form.length && ct < 0) { r.headers.push(['Content-Type', 'application/x-www-form-urlencoded']); r.implicitForm = true; }
  ct = hdrFind(r.headers, 'content-type');
  r.contentType = ct >= 0 ? r.headers[ct][1] : '';
  r.json = undefined;
  if (body !== null && /json/i.test(r.contentType)) { try { r.json = JSON.parse(body); } catch (e) { r.warnings.push('The body is sent as JSON but is not valid JSON: it is passed through as a raw string.'); } }
  r.formPairs = null;
  if (body !== null && /x-www-form-urlencoded/i.test(r.contentType) && !r.dataFile) {
    var pairs = body.split('&').filter(Boolean).map(function (p) { var e = p.indexOf('='); var kk = e < 0 ? p : p.slice(0, e), vv = e < 0 ? '' : p.slice(e + 1);
      try { return [decodeURIComponent(kk.replace(/\+/g, ' ')), decodeURIComponent(vv.replace(/\+/g, ' '))]; } catch (er) { return null; } });
    if (pairs.length && pairs.every(Boolean)) r.formPairs = pairs;
  }
  if (r.form.length && ct >= 0 && /multipart/i.test(r.contentType)) { r.headers.splice(ct, 1); r.warnings.push('Removed the explicit multipart Content-Type header: the HTTP library must generate it with the boundary.'); }
  return r;
};

function applyCurl(r, opt, val) {
  var name = CURL_VAL[opt] || CURL_BOOL[opt], m;
  switch (name) {
    case 'request': r.method = val; break;
    case 'header':
      if (val.charAt(0) === '@') { r.warnings.push('Headers read from file ' + val.slice(1) + ' are not included.'); break; }
      m = /^([^:;]+)(?::\s?(.*)|;)$/.exec(val);
      if (!m) { r.warnings.push('Could not read header "' + val + '".'); break; }
      if (m[2] === '' && val.indexOf(':') >= 0) { var ix = hdrFind(r.headers, m[1].trim()); if (ix >= 0) r.headers.splice(ix, 1); break; } // "X-Foo:" removes a header
      r.headers.push([m[1].trim(), m[2] === undefined ? '' : m[2]]); break;
    case 'data': case 'data-binary':
      if (val.charAt(0) === '@') { r.dataFile = val.slice(1); r.warnings.push('The body is read from the file "' + val.slice(1) + '": the code below sends a placeholder, read the file yourself.'); r.data.push('<contents of ' + val.slice(1) + '>'); break; }
      r.data.push(name === 'data' ? val.replace(/[\r\n]/g, '') && val : val); break;
    case 'data-raw': r.data.push(val); break;
    case 'data-urlencode':
      m = /^([^=@]*)([=@])([\s\S]*)$/.exec(val);
      if (!m) r.data.push(curlUrlencode(val));
      else if (m[2] === '@') { r.dataFile = m[3]; r.warnings.push('--data-urlencode reads ' + m[3] + ' from a file: replace the placeholder.'); r.data.push((m[1] ? m[1] + '=' : '') + curlUrlencode('<contents of ' + m[3] + '>')); }
      else r.data.push((m[1] ? m[1] + '=' : '') + curlUrlencode(m[3]));
      break;
    case 'json':
      r.data.push(val);
      if (hdrFind(r.headers, 'content-type') < 0) r.headers.push(['Content-Type', 'application/json']);
      if (hdrFind(r.headers, 'accept') < 0) r.headers.push(['Accept', 'application/json']);
      break;
    case 'user': m = val.indexOf(':'); r.auth = m < 0 ? [val, ''] : [val.slice(0, m), val.slice(m + 1)]; if (m < 0) r.warnings.push('-u without a password: curl would prompt for it; the code uses an empty password.'); break;
    case 'form': case 'form-string':
      m = /^([^=]+)=([\s\S]*)$/.exec(val);
      if (!m) { r.warnings.push('Could not read form field "' + val + '".'); break; }
      var v = m[2], fld = { name: m[1], value: v };
      if (name === 'form') {
        var parts = v.split(';'), first = parts[0];
        if (first.charAt(0) === '@' || first.charAt(0) === '<') { fld.file = first.slice(1); fld.value = null; if (first.charAt(0) === '<') { fld.file = null; fld.value = '<contents of ' + first.slice(1) + '>'; } }
        else fld.value = first;
        parts.slice(1).forEach(function (p) { var q = /^\s*(type|filename)=(.*)$/.exec(p); if (q) fld[q[1]] = q[2].replace(/^"|"$/g, ''); });
      }
      r.form.push(fld); break;
    case 'cookie':
      if (val.indexOf('=') < 0) { r.warnings.push('-b ' + val + ' reads cookies from a file: not converted.'); break; }
      var ci = hdrFind(r.headers, 'cookie');
      if (ci >= 0) r.headers[ci][1] += '; ' + val; else r.headers.push(['Cookie', val]);
      break;
    case 'user-agent': r.headers.push(['User-Agent', val]); break;
    case 'referer': r.headers.push(['Referer', val.replace(/;auto$/, '')]); break;
    case 'bearer': r.headers.push(['Authorization', 'Bearer ' + val]); break;
    case 'range': r.headers.push(['Range', 'bytes=' + val]); break;
    case 'url': if (!r.url) r.url = val; break;
    case 'max-time': r.timeout = parseFloat(val); break;
    case 'connect-timeout': if (r.timeout === null) r.timeout = parseFloat(val); break;
    case 'proxy': r.proxy = /^[a-z0-9]+:\/\//i.test(val) ? val : 'http://' + val; break;
    case 'location': r.follow = true; break;
    case 'insecure': r.insecure = true; break;
    case 'compressed': r.compressed = true; break;
    case 'get': r.get = true; break;
    case 'head': r.head = true; break;
    case 'digest': r.digest = true; r.warnings.push('--digest authentication is converted as Basic auth: switch to your library\'s digest support.'); break;
    case 'ntlm': r.warnings.push(opt + ' authentication is not converted.'); break;
    case 'upload-file': r.uploadFile = val; r.data.push('<contents of ' + val + '>'); r.dataFile = val; r.warnings.push('-T uploads the file ' + val + ': the code sends a placeholder body, read the file yourself.'); break;
    case 'output': case 'remote-name': r.warnings.push('Output to a file (' + opt + ') is not converted: write the response body yourself.'); break;
    case 'cacert': case 'cert': case 'key': r.warnings.push(opt + ' ' + val + ' (client/CA certificates) is not converted.'); break;
    case 'aws': r.warnings.push('--aws-sigv4 signing is not converted: use an AWS SDK.'); break;
    case 'config': r.warnings.push('Options read from a config file (' + opt + ') are not included.'); break;
    default: break; // silent / verbose / output formatting options don't change the request
  }
}

/* code generators */
function jstr(s) { return JSON.stringify(s); }
function pystr(s) {
  var q = s.indexOf("'") >= 0 && s.indexOf('"') < 0 ? '"' : "'";
  return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, function (c) { return '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + q;
}
function phpstr(s) { return /[\n\r\t\x00-\x1f]/.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, function (c) { return '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + '"' : "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function pyval(v, ind) {
  ind = ind || '';
  var nx = ind + '    ';
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return pystr(v);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return nx + pyval(x, nx); }).join(',\n') + ',\n' + ind + ']' : '[]';
  var ks = Object.keys(v);
  return ks.length ? '{\n' + ks.map(function (k) { return nx + pystr(k) + ': ' + pyval(v[k], nx); }).join(',\n') + ',\n' + ind + '}' : '{}';
}
function jsval(v, ind) { return JSON.stringify(v, null, 2).replace(/\n/g, '\n' + ind); }
function phpval(v, ind) {
  ind = ind || ''; var nx = ind + '    ';
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return phpstr(v);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return nx + phpval(x, nx); }).join(',\n') + ',\n' + ind + ']' : '[]';
  var ks = Object.keys(v);
  return ks.length ? '[\n' + ks.map(function (k) { return nx + phpstr(k) + ' => ' + phpval(v[k], nx); }).join(',\n') + ',\n' + ind + ']' : 'new stdClass()';
}
function b64ascii(s) { try { return typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); } catch (e) { return ''; } }

T.curlToPython = function (r) {
  var L = ['import requests', ''], args = ['url'], hs = r.headers.slice(), cookies = null;
  var ci = hdrFind(hs, 'cookie');
  if (ci >= 0) { cookies = hs[ci][1].split(/;\s*/).filter(Boolean).map(function (p) { var e = p.indexOf('='); return [p.slice(0, e < 0 ? p.length : e).trim(), e < 0 ? '' : p.slice(e + 1)]; }); hs.splice(ci, 1); }
  var useJson = r.json !== undefined, useForm = !useJson && r.formPairs && r.implicitForm;
  if (useJson) { var ct = hdrFind(hs, 'content-type'); if (ct >= 0 && /^application\/json$/i.test(hs[ct][1].trim())) hs.splice(ct, 1); }
  if (useForm) hs.splice(hdrFind(hs, 'content-type'), 1);
  L.push('url = ' + pystr(r.url));
  if (hs.length) { L.push('headers = {'); hs.forEach(function (h) { L.push('    ' + pystr(h[0]) + ': ' + pystr(h[1]) + ','); }); L.push('}'); args.push('headers=headers'); }
  if (cookies) { L.push('cookies = {'); cookies.forEach(function (c) { L.push('    ' + pystr(c[0]) + ': ' + pystr(c[1]) + ','); }); L.push('}'); args.push('cookies=cookies'); }
  if (r.body !== null) {
    if (useJson) { L.push('json_data = ' + pyval(r.json)); args.push('json=json_data'); }
    else if (useForm) {
      var dup = {}, hasDup = r.formPairs.some(function (p) { if (dup[p[0]]) return true; dup[p[0]] = 1; return false; });
      if (hasDup) { L.push('data = ['); r.formPairs.forEach(function (p) { L.push('    (' + pystr(p[0]) + ', ' + pystr(p[1]) + '),'); }); L.push(']'); }
      else { L.push('data = {'); r.formPairs.forEach(function (p) { L.push('    ' + pystr(p[0]) + ': ' + pystr(p[1]) + ','); }); L.push('}'); }
      args.push('data=data');
    } else { L.push('data = ' + pystr(r.body)); args.push(/[^\x00-\x7f]/.test(r.body) ? "data=data.encode('utf-8')" : 'data=data'); }
  }
  if (r.form.length) {
    var plain = r.form.filter(function (f) { return !f.file; }), files = r.form.filter(function (f) { return f.file; });
    if (files.length) {
      L.push('files = {');
      files.forEach(function (f) { var fname = f.filename || f.file.split('/').pop(); L.push('    ' + pystr(f.name) + ': (' + pystr(fname) + ', open(' + pystr(f.file) + ", 'rb')" + (f.type ? ', ' + pystr(f.type) : '') + '),'); });
      L.push('}'); args.push('files=files');
    } else { args.push('files=files'); L.push('files = {'); plain.forEach(function (f) { L.push('    ' + pystr(f.name) + ': (None, ' + pystr(f.value) + '),'); }); L.push('}'); plain = []; }
    if (plain.length) { L.push('data = {'); plain.forEach(function (f) { L.push('    ' + pystr(f.name) + ': ' + pystr(f.value) + ','); }); L.push('}'); args.push('data=data'); }
  }
  if (r.auth) args.push('auth=(' + pystr(r.auth[0]) + ', ' + pystr(r.auth[1]) + ')');
  if (r.proxy) { L.push('proxies = {' + pystr('http') + ': ' + pystr(r.proxy) + ', ' + pystr('https') + ': ' + pystr(r.proxy) + '}'); args.push('proxies=proxies'); }
  if (r.timeout) args.push('timeout=' + r.timeout);
  if (r.insecure) args.push('verify=False');
  if (r.method === 'HEAD' && r.follow) args.push('allow_redirects=True');
  L.push('');
  var fn = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' }[r.method];
  var call = fn ? 'requests.' + fn + '(' : 'requests.request(' + pystr(r.method) + ', ';
  var one = call + args.join(', ') + ')';
  L.push('response = ' + (one.length <= 88 ? one : call + '\n    ' + args.join(',\n    ') + ',\n)'));
  L.push('print(response.status_code)', 'print(response.text)');
  return L.join('\n') + '\n';
};

T.curlToFetch = function (r) {
  var L = [], o = [], hs = r.headers.slice();
  if (r.auth) hs.push(['Authorization', 'Basic ' + b64ascii(r.auth[0] + ':' + r.auth[1])]);
  if (r.method !== 'GET') o.push('  method: ' + jstr(r.method));
  if (hs.length) o.push('  headers: {\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') + '\n  }');
  if (r.body !== null) o.push('  body: ' + (r.json !== undefined ? 'JSON.stringify(' + jsval(r.json, '  ') + ')' : r.formPairs && r.implicitForm ? 'new URLSearchParams(' + jsval(r.formPairs.reduce(function (a, p) { a.push(p); return a; }, []), '  ') + ')' : jstr(r.body)));
  if (r.form.length) {
    L.push('const form = new FormData();');
    r.form.forEach(function (f) {
      if (f.file) L.push('form.append(' + jstr(f.name) + ', fileInput.files[0], ' + jstr(f.filename || f.file.split('/').pop()) + '); // the file ' + f.file + ' (in Node 20+: await fs.openAsBlob(' + jstr(f.file) + '))');
      else L.push('form.append(' + jstr(f.name) + ', ' + jstr(f.value) + ');');
    });
    L.push('');
    o.push('  body: form');
  }
  if (r.timeout) o.push('  signal: AbortSignal.timeout(' + Math.round(r.timeout * 1000) + ')');
  if (r.insecure) L.unshift('// -k/--insecure has no fetch equivalent in browsers. In Node you can (for testing only) run with NODE_TLS_REJECT_UNAUTHORIZED=0.');
  if (hs.some(function (h) { return /^(cookie|user-agent|referer|host|accept-encoding|content-length|connection|origin)$/i.test(h[0]); })) L.unshift('// Note: browsers silently drop "forbidden" headers such as Cookie, User-Agent, Referer and Host. This runs as-is in Node 18+.');
  if (r.proxy) L.unshift('// Proxy ' + r.proxy + ': fetch has no proxy option; in Node use undici\'s ProxyAgent as the "dispatcher" option.');
  L.push('const response = await fetch(' + jstr(r.url) + (o.length ? ', {\n' + o.join(',\n') + '\n}' : '') + ');');
  L.push('console.log(response.status);', 'console.log(await response.text());');
  return L.join('\n') + '\n';
};

T.curlToAxios = function (r) {
  var L = ['const axios = require("axios");'], o = [], pre = [], hs = r.headers.slice();
  if (r.insecure) { L.push('const https = require("https");'); }
  if (r.form.length) { L.push('const FormData = require("form-data");'); if (r.form.some(function (f) { return f.file; })) L.push('const fs = require("fs");'); }
  L.push('');
  if (r.form.length) {
    pre.push('const form = new FormData();');
    r.form.forEach(function (f) { pre.push('form.append(' + jstr(f.name) + ', ' + (f.file ? 'fs.createReadStream(' + jstr(f.file) + ')' : jstr(f.value)) + ');'); });
    pre.push('');
  }
  o.push('  method: ' + jstr(r.method.toLowerCase()), '  url: ' + jstr(r.url));
  if (r.form.length) o.push('  headers: {\n    ...form.getHeaders()' + (hs.length ? ',\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') : '') + '\n  }');
  else if (hs.length) o.push('  headers: {\n' + hs.map(function (h) { return '    ' + jstr(h[0]) + ': ' + jstr(h[1]); }).join(',\n') + '\n  }');
  if (r.body !== null) o.push('  data: ' + (r.json !== undefined ? jsval(r.json, '  ') : jstr(r.body)));
  if (r.form.length) o.push('  data: form');
  if (r.auth) o.push('  auth: { username: ' + jstr(r.auth[0]) + ', password: ' + jstr(r.auth[1]) + ' }');
  if (r.timeout) o.push('  timeout: ' + Math.round(r.timeout * 1000));
  if (r.insecure) o.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false })');
  if (r.proxy) { var pm = /^(\w+):\/\/(?:([^:@]*)(?::([^@]*))?@)?([^:\/]+)(?::(\d+))?/.exec(r.proxy); if (pm) o.push('  proxy: { protocol: ' + jstr(pm[1]) + ', host: ' + jstr(pm[4]) + ', port: ' + (pm[5] || (pm[1] === 'https' ? 443 : 1080)) + (pm[2] ? ', auth: { username: ' + jstr(decodeURIComponent(pm[2])) + ', password: ' + jstr(decodeURIComponent(pm[3] || '')) + ' }' : '') + ' }'); }
  return L.concat(pre).join('\n') + 'axios({\n' + o.join(',\n') + '\n})\n  .then((response) => {\n    console.log(response.status);\n    console.log(response.data);\n  })\n  .catch((error) => console.error(error.response ? error.response.status : error.message));\n';
};

T.curlToGo = function (r) {
  var imp = { 'fmt': 1, 'io': 1, 'net/http': 1 }, B = [];
  var bodyVar = 'nil';
  if (r.body !== null) { imp.strings = 1; bodyVar = 'body'; B.push('\tbody := strings.NewReader(' + (r.body.indexOf('`') < 0 && /\n/.test(r.body) ? '`' + r.body + '`' : jstr(r.body)) + ')'); }
  if (r.form.length) {
    imp.bytes = 1; imp['mime/multipart'] = 1; bodyVar = 'payload';
    B.push('\tpayload := &bytes.Buffer{}', '\twriter := multipart.NewWriter(payload)');
    r.form.forEach(function (f) {
      if (f.file) {
        imp.os = 1; imp['path/filepath'] = 1;
        B.push('\t{', '\t\tf, err := os.Open(' + jstr(f.file) + ')', '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}', '\t\tdefer f.Close()',
          '\t\tpart, err := writer.CreateFormFile(' + jstr(f.name) + ', ' + (f.filename ? jstr(f.filename) : 'filepath.Base(' + jstr(f.file) + ')') + ')', '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}',
          '\t\tif _, err := io.Copy(part, f); err != nil {', '\t\t\tpanic(err)', '\t\t}', '\t}');
      } else B.push('\t_ = writer.WriteField(' + jstr(f.name) + ', ' + jstr(f.value) + ')');
    });
    B.push('\twriter.Close()');
  }
  B.push('', '\treq, err := http.NewRequest(' + jstr(r.method) + ', ' + jstr(r.url) + ', ' + bodyVar + ')', '\tif err != nil {', '\t\tpanic(err)', '\t}');
  r.headers.forEach(function (h) { B.push('\treq.Header.' + (h[0].toLowerCase() === 'host' ? 'Set' : 'Set') + '(' + jstr(h[0]) + ', ' + jstr(h[1]) + ')'); });
  if (hdrFind(r.headers, 'host') >= 0) B.push('\treq.Host = req.Header.Get("Host")');
  if (r.form.length) B.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  if (r.auth) B.push('\treq.SetBasicAuth(' + jstr(r.auth[0]) + ', ' + jstr(r.auth[1]) + ')');
  var cl = [];
  if (r.timeout) { imp.time = 1; cl.push('\t\tTimeout: ' + (r.timeout >= 1 && r.timeout === Math.round(r.timeout) ? r.timeout + ' * time.Second' : Math.round(r.timeout * 1000) + ' * time.Millisecond') + ','); }
  if (r.insecure || r.proxy) {
    var tr = [];
    if (r.insecure) { imp['crypto/tls'] = 1; tr.push('\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},'); }
    if (r.proxy) { imp['net/url'] = 1; B.push('\tproxyURL, _ := url.Parse(' + jstr(r.proxy) + ')'); tr.push('\t\t\tProxy:' + (r.insecure ? '           ' : ' ') + 'http.ProxyURL(proxyURL),'); }
    cl.push('\t\tTransport: &http.Transport{\n' + tr.join('\n') + '\n\t\t},');
  }
  B.push('', cl.length ? '\tclient := &http.Client{\n' + cl.join('\n') + '\n\t}' : '\tclient := &http.Client{}');
  B.push('\tresp, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()', '', '\trespBody, err := io.ReadAll(resp.Body)', '\tif err != nil {', '\t\tpanic(err)', '\t}',
    '\tfmt.Println(resp.Status)', '\tfmt.Println(string(respBody))');
  var imports = Object.keys(imp).sort();
  return 'package main\n\nimport (\n' + imports.map(function (x) { return '\t"' + x + '"'; }).join('\n') + '\n)\n\nfunc main() {\n' + B.join('\n').replace(/^\n/, '') + '\n}\n';
};

T.curlToPhp = function (r) {
  var L = ['<?php', '', '$ch = curl_init();', 'curl_setopt($ch, CURLOPT_URL, ' + phpstr(r.url) + ');', 'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);'];
  if (r.method === 'HEAD') L.push('curl_setopt($ch, CURLOPT_NOBODY, true);');
  else if (r.method !== 'GET' && !(r.method === 'POST' && (r.body !== null || r.form.length))) L.push('curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ' + phpstr(r.method) + ');');
  if (r.headers.length) { L.push('curl_setopt($ch, CURLOPT_HTTPHEADER, ['); r.headers.forEach(function (h) { L.push('    ' + phpstr(h[0] + ': ' + h[1]) + ','); }); L.push(']);'); }
  if (r.body !== null) L.push('curl_setopt($ch, CURLOPT_POSTFIELDS, ' + phpstr(r.body) + ');');
  if (r.form.length) {
    L.push('curl_setopt($ch, CURLOPT_POSTFIELDS, [');
    r.form.forEach(function (f) { L.push('    ' + phpstr(f.name) + ' => ' + (f.file ? 'new CURLFile(' + phpstr(f.file) + (f.type || f.filename ? ', ' + phpstr(f.type || '') + (f.filename ? ', ' + phpstr(f.filename) : '') : '') + ')' : phpstr(f.value)) + ','); });
    L.push(']);');
  }
  if (r.auth) L.push('curl_setopt($ch, CURLOPT_USERPWD, ' + phpstr(r.auth[0] + ':' + r.auth[1]) + ');');
  if (r.digest) L.push('curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_DIGEST);');
  if (r.follow) L.push('curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);');
  if (r.compressed) L.push("curl_setopt($ch, CURLOPT_ENCODING, ''); // --compressed: accept and decode gzip/deflate/br");
  if (r.insecure) L.push('curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);', 'curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);');
  if (r.timeout) L.push('curl_setopt($ch, CURLOPT_TIMEOUT, ' + Math.ceil(r.timeout) + ');');
  if (r.proxy) L.push('curl_setopt($ch, CURLOPT_PROXY, ' + phpstr(r.proxy) + ');');
  L.push('', '$response = curl_exec($ch);', 'if ($response === false) {', "    echo 'cURL error: ' . curl_error($ch) . PHP_EOL;", '} else {',
    '    echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . PHP_EOL;', '    echo $response . PHP_EOL;', '}', 'curl_close($ch);');
  return L.join('\n') + '\n';
};
T.CURL_LANGS = { python: T.curlToPython, fetch: T.curlToFetch, axios: T.curlToAxios, go: T.curlToGo, php: T.curlToPhp };
/* ---------------- .gitignore generator & tester ---------------- */
T.GITIGNORE = {
  Node: { label: 'Node.js / npm / Yarn / pnpm', body: '# Dependencies\nnode_modules/\njspm_packages/\n.pnpm-store/\n\n# Logs\nlogs/\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n# Build output and caches\ndist/\nbuild/\ncoverage/\n.nyc_output/\n.cache/\n.parcel-cache/\n.next/\n.nuxt/\n.svelte-kit/\n.turbo/\n.vite/\n.eslintcache\n*.tsbuildinfo\n\n# Yarn Berry (keep the files that should be committed)\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/sdks\n!.yarn/versions\n.pnp.*\n\n# Environment files (commit a .env.example instead)\n.env\n.env.*\n!.env.example' },
  Python: { label: 'Python', body: '# Byte-compiled files\n__pycache__/\n*.py[cod]\n*$py.class\n\n# Virtual environments\n.venv/\nvenv/\nenv/\nENV/\n\n# Packaging\nbuild/\ndist/\n*.egg-info/\n.eggs/\nwheels/\n*.egg\n\n# Test, type-check and lint caches\n.pytest_cache/\n.coverage\n.coverage.*\nhtmlcov/\n.tox/\n.nox/\n.mypy_cache/\n.ruff_cache/\n.pytype/\n\n# Jupyter\n.ipynb_checkpoints/\n\n# Environment files\n.env\n.env.*\n!.env.example' },
  Java: { label: 'Java (Maven / Gradle)', body: '# Compiled classes and packages\n*.class\n*.jar\n*.war\n*.ear\n*.nar\nhs_err_pid*\nreplay_pid*\n\n# Maven\ntarget/\npom.xml.tag\npom.xml.releaseBackup\npom.xml.versionsBackup\nrelease.properties\n.mvn/timing.properties\n!.mvn/wrapper/maven-wrapper.jar\n\n# Gradle\n.gradle/\nbuild/\n!gradle/wrapper/gradle-wrapper.jar\n\n# Eclipse / NetBeans\n.classpath\n.project\n.settings/\nbin/\nnbproject/private/' },
  Go: { label: 'Go', body: '# Binaries\n*.exe\n*.exe~\n*.dll\n*.so\n*.dylib\n\n# Test binaries and coverage\n*.test\n*.out\ncoverage.*\n\n# Workspace file (usually local)\ngo.work\ngo.work.sum\n\n# Vendored dependencies (remove this line if you commit vendor/)\n# vendor/' },
  Rust: { label: 'Rust / Cargo', body: '# Build output\ntarget/\n\n# Backup files from rustfmt\n**/*.rs.bk\n\n# Debug info on Windows\n*.pdb\n\n# Libraries usually do not commit Cargo.lock; applications should.\n# Cargo.lock' },
  Docker: { label: 'Docker', body: '# Local overrides and secrets\ndocker-compose.override.yml\ncompose.override.yaml\n.env\n\n# Data volumes mounted into the project folder\n.docker-data/' },
  Terraform: { label: 'Terraform', body: '# Local state and provider plugins\n.terraform/\n*.tfstate\n*.tfstate.*\ncrash.log\ncrash.*.log\n\n# Variable files often contain secrets\n*.tfvars\n*.tfvars.json\n\n# Local overrides\noverride.tf\noverride.tf.json\n*_override.tf\n*_override.tf.json\n.terraformrc\nterraform.rc\n\n# Commit .terraform.lock.hcl: it pins provider versions' },
  PHP: { label: 'PHP / Composer', body: '# Composer\nvendor/\ncomposer.phar\n\n# Framework caches (Laravel / Symfony)\n.phpunit.result.cache\n.php-cs-fixer.cache\nstorage/*.key\nvar/cache/\nvar/log/\n\n# Environment files\n.env\n.env.*\n!.env.example' },
  Ruby: { label: 'Ruby / Rails', body: '# Bundler\n.bundle/\nvendor/bundle/\n\n# Rails\nlog/*\ntmp/*\n!log/.keep\n!tmp/.keep\nstorage/*\n!storage/.keep\npublic/assets/\n/config/master.key\n\n# Gems\n*.gem\ncoverage/' },
  DotNet: { label: '.NET / C#', body: '# Build output\n[Bb]in/\n[Oo]bj/\n[Dd]ebug/\n[Rr]elease/\nx64/\nx86/\n[Ll]og/\n\n# Visual Studio\n.vs/\n*.user\n*.suo\n*.userprefs\n\n# NuGet\n*.nupkg\n*.snupkg\npackages/\n!**/packages/build/\n\n# Test results\nTestResults/\n[Tt]est[Rr]esult*/' },
  Android: { label: 'Android', body: '# Gradle and build output\n.gradle/\nbuild/\n/captures\n.externalNativeBuild/\n.cxx/\n\n# Local configuration (SDK path)\nlocal.properties\n\n# Android Studio\n*.iml\n.idea/\n\n# Signing keys: never commit these\n*.jks\n*.keystore\n\n# Generated files\n*.apk\n*.aab\n*.ap_\n*.dex\noutput-metadata.json' },
  macOS: { label: 'macOS', body: '# macOS Finder and system files\n.DS_Store\n.AppleDouble\n.LSOverride\n._*\n.Spotlight-V100\n.Trashes\n.fseventsd\n.DocumentRevisions-V100\n.TemporaryItems\n.VolumeIcon.icns' },
  Windows: { label: 'Windows', body: '# Windows thumbnail and folder files\nThumbs.db\nThumbs.db:encryptable\nehthumbs.db\nehthumbs_vista.db\ndesktop.ini\n$RECYCLE.BIN/\n\n# Windows shortcuts\n*.lnk\n\n# Installer caches\n*.stackdump' },
  Linux: { label: 'Linux', body: '# Editor backup and temporary files\n*~\n.fuse_hidden*\n.directory\n.Trash-*\n.nfs*' },
  VSCode: { label: 'VS Code', body: '# VS Code: ignore personal settings but keep shared ones\n.vscode/*\n!.vscode/settings.json\n!.vscode/tasks.json\n!.vscode/launch.json\n!.vscode/extensions.json\n!.vscode/*.code-snippets\n.history/\n*.vsix' },
  JetBrains: { label: 'JetBrains (IntelliJ, PyCharm, WebStorm…)', body: '# JetBrains IDEs\n.idea/\n*.iml\n*.ipr\n*.iws\nout/\n.idea_modules/\n\n# If you share run configurations, use these instead of ignoring .idea/ entirely:\n# .idea/workspace.xml\n# .idea/tasks.xml\n# .idea/usage.statistics.xml' },
  Vim: { label: 'Vim / Emacs', body: '# Vim swap, undo and session files\n[._]*.s[a-v][a-z]\n!*.svg\n[._]*.sw[a-p]\n[._]s[a-rt-v][a-z]\n[._]ss[a-gi-z]\n[._]sw[a-p]\nSession.vim\nSessionx.vim\n.netrwhist\ntags\n[._]*.un~\n\n# Emacs\n*~\n\\#*\\#\n.\\#*' },
  Secrets: { label: 'Secrets & keys (recommended)', body: '# Private keys and credentials: never commit these\n*.pem\n*.key\n*.p12\n*.pfx\nid_rsa\nid_ed25519\n*.secret\nsecrets.*\n!secrets.example.*\n.env\n.env.*\n!.env.example' }
};

// Combine templates and drop duplicate patterns, unless a "!" rule in between could make the order matter.
T.gitignoreCombine = function (names, extra) {
  var out = [], seen = {};
  names.forEach(function (n) {
    var t = T.GITIGNORE[n]; if (!t) return;
    out.push('### ' + t.label + ' ###');
    t.body.split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split('\n'), kept = [], pats = 0, dropped = 0;
      lines.forEach(function (line) {
        var pat = line.trim();
        if (!pat || pat.charAt(0) === '#') { kept.push(line); return; }
        pats++;
        if (pat.charAt(0) === '!') { Object.keys(seen).forEach(function (k) { seen[k].push(pat.slice(1)); }); kept.push(line); return; }
        if (seen[pat] && !seen[pat].some(function (neg) { return T.gitignoreCheck(pat, neg).ignored || T.gitignoreCheck(neg, pat.replace(/\/$/, '')).ignored; })) { dropped++; return; }
        seen[pat] = []; kept.push(line);
      });
      if (pats && dropped === pats) return;
      out.push(kept.join('\n'), '');
    });
  });
  if (extra && extra.trim()) out.push('### Custom ###', extra.trim(), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
};

// Compile one gitignore pattern into a matcher, following git's wildmatch rules.
function giGlobToRe(p) {
  var re = '', i = 0, n = p.length;
  while (i < n) {
    var c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        var atStart = i === 0 || p[i - 1] === '/', j = i; while (p[j] === '*') j++;
        var atEnd = j === n || p[j] === '/';
        if (atStart && atEnd) {
          if (j === n) { re += i === 0 ? '.*' : '.*'; i = j; continue; }          // "**" at end: everything inside
          re += '(?:.*/)?'; i = j + 1; continue;                                   // "**/": zero or more directories
        }
        re += '[^/]*'; i = j; continue;
      }
      re += '[^/]*'; i++; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '[') {
      var k = i + 1, cls = '';
      if (p[k] === '!' || p[k] === '^') { cls = '^'; k++; }
      if (p[k] === ']') { cls += '\\]'; k++; }
      while (k < n && p[k] !== ']') {
        if (p[k] === '\\' && k + 1 < n) { cls += '\\' + p[k + 1]; k += 2; continue; }
        if (p[k] === '[' && p[k + 1] === ':') { var e = p.indexOf(':]', k + 2); if (e > 0) { var nm = p.slice(k + 2, e); cls += ({ alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', xdigit: '0-9a-fA-F', punct: '!-\\/:-@\\[-`{-~' })[nm] || ''; k = e + 2; continue; } }
        cls += /[\]\\^]/.test(p[k]) ? '\\' + p[k] : p[k]; k++;
      }
      if (k >= n) { re += '\\['; i++; continue; }  // unterminated class: literal "["
      re += cls.charAt(0) === '^' ? '(?![/])[' + cls + ']' : '[' + cls + ']'; i = k + 1; continue;
    }
    if (c === '\\' && i + 1 < n) { re += p[i + 1].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i += 2; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i++;
  }
  return re;
}

T.gitignoreParse = function (text) {
  var rules = [];
  String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (raw, idx) {
    var line = raw;
    // trailing spaces are ignored unless escaped with a backslash
    line = line.replace(/((?:\\\\)*)(\\?) +$/, function (m, bs, esc1) { return bs + (esc1 ? ' ' : ''); });
    if (!line || line.charAt(0) === '#') return;
    var neg = false;
    if (line.charAt(0) === '!') { neg = true; line = line.slice(1); }
    else if (line.slice(0, 2) === '\\!' || line.slice(0, 2) === '\\#') line = line.slice(1);
    if (!line) return;
    var dirOnly = false;
    if (/[^\\]\/$|^\/$/.test(line)) { dirOnly = true; line = line.replace(/\/+$/, ''); }
    if (!line) return;
    var anchored = line.indexOf('/') >= 0;
    if (line.charAt(0) === '/') line = line.slice(1);
    var re = giGlobToRe(line);
    rules.push({ line: idx + 1, text: raw.replace(/\s+$/, ''), neg: neg, dirOnly: dirOnly, anchored: anchored, re: new RegExp('^' + re + '$') });
  });
  return rules;
};

function giMatchOne(rules, path, isDir) {
  var base = path.slice(path.lastIndexOf('/') + 1), hit = null;
  for (var i = rules.length - 1; i >= 0; i--) {
    var r = rules[i];
    if (r.dirOnly && !isDir) continue;
    if (r.anchored ? r.re.test(path) : r.re.test(base)) { hit = r; break; }
  }
  return hit;
}

// Is a path ignored? Mirrors git: a path inside an ignored directory is ignored, and cannot be re-included by a later "!" rule.
T.gitignoreCheck = function (rules, path) {
  if (typeof rules === 'string') rules = T.gitignoreParse(rules);
  var p = String(path).replace(/^\s+|[\r\n]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  var isDir = /\/$/.test(p); p = p.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (!p) return { ignored: false, rule: null, path: p };
  var parts = p.split('/');
  for (var d = 1; d < parts.length; d++) {
    var dir = parts.slice(0, d).join('/'), h = giMatchOne(rules, dir, true);
    if (h && !h.neg) return { ignored: true, rule: h, path: p, via: dir + '/', isDir: isDir };
  }
  var hit = giMatchOne(rules, p, isDir);
  return { ignored: !!(hit && !hit.neg), rule: hit, path: p, isDir: isDir };
};
/* ---------------- CSV <-> JSON ---------------- */
// RFC 4180 parser: quoted fields, "" escapes, delimiters and line breaks inside quotes, CRLF/LF/CR line endings.
T.csvParse = function (text, delim, limit) {
  var s = String(text), rows = [], row = [], f = '', i = 0, n = s.length, q = false, quotedField = false, warn = [];
  if (s.charCodeAt(0) === 0xfeff) i = 1;
  delim = delim || ',';
  function endField() { row.push(f); f = ''; quotedField = false; }
  function endRow() { endField(); rows.push(row); row = []; }
  while (i < n) {
    var c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '' && !quotedField) { q = true; quotedField = true; i++; continue; }
    if (c === '"' && quotedField) { f += c; i++; if (warn.length < 5) warn.push('Stray quote after a closing quote on row ' + (rows.length + 1)); continue; }
    if (c === delim) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') { endRow(); i += c === '\r' && s[i + 1] === '\n' ? 2 : 1; if (limit && rows.length >= limit) return { rows: rows, warnings: warn, truncated: true }; continue; }
    f += c; i++;
  }
  if (q) warn.push('Unclosed quote: a field starting with " never ends (row ' + (rows.length + 1) + ')');
  if (f !== '' || row.length || quotedField) endRow();
  return { rows: rows, warnings: warn };
};

T.csvDetectDelimiter = function (text) {
  var sample = String(text).slice(0, 20000), best = ',', bestScore = -1;
  [',', ';', '\t', '|'].forEach(function (d) {
    var rows = T.csvParse(sample, d, 30).rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
    if (rows.length > 1 && sample.length >= 20000) rows.pop(); // last row may be cut off
    if (!rows.length) return;
    var counts = rows.map(function (r) { return r.length; }), first = counts[0];
    if (first < 2) return;
    var same = counts.filter(function (c) { return c === first; }).length / counts.length;
    var score = same * 100 + Math.min(first, 50);
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best;
};

function csvInfer(v) {
  if (v === '') return null;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(v)) { var x = Number(v); if (isFinite(x)) return x; }
  if (v === 'true' || v === 'TRUE' || v === 'True') return true;
  if (v === 'false' || v === 'FALSE' || v === 'False') return false;
  if (v === 'null' || v === 'NULL') return null;
  return v;
}

T.csvToJson = function (text, opts) {
  opts = opts || {};
  var d = !opts.delimiter || opts.delimiter === 'auto' ? T.csvDetectDelimiter(text) : opts.delimiter;
  var p = T.csvParse(text, d), rows = p.rows;
  if (opts.skipEmpty !== false) rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  var conv = opts.infer ? csvInfer : function (v) { return v; };
  var warnings = p.warnings.slice(), data;
  if (opts.header !== false && rows.length) {
    var used = {}, keys = rows[0].map(function (h, k) {
      var key = h.trim() || 'column_' + (k + 1), base = key, m = 2;
      while (used[key]) key = base + '_' + m++;
      if (key !== base) warnings.push('Duplicate column name "' + base + '" renamed to "' + key + '"');
      used[key] = 1; return key;
    });
    var ragged = 0;
    data = rows.slice(1).map(function (r) {
      var o = {};
      if (r.length !== keys.length) ragged++;
      for (var k = 0; k < Math.max(keys.length, r.length); k++) {
        var key = k < keys.length ? keys[k] : 'column_' + (k + 1);
        o[key] = k < r.length ? conv(r[k]) : (opts.infer ? null : '');
      }
      return o;
    });
    if (ragged) warnings.push(ragged + ' row' + (ragged > 1 ? 's have' : ' has') + ' a different number of fields than the header (' + keys.length + ')');
  } else data = rows.map(function (r) { return r.map(conv); });
  return { data: data, delimiter: d, rows: rows.length, warnings: warnings };
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function csvQuote(s, d, always) {
  return always || s.indexOf(d) >= 0 || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
T.jsonToCsv = function (value, opts) {
  opts = opts || {};
  var d = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : ',', eol = opts.crlf ? '\r\n' : '\n', lines = [];
  if (typeof value === 'string') value = JSON.parse(value);
  if (value && !Array.isArray(value) && typeof value === 'object') {
    var ks0 = Object.keys(value);
    // {"items": [...]} wrapper: use the first array property
    var arrKey = ks0.filter(function (k) { return Array.isArray(value[k]) && value[k].length && typeof value[k][0] === 'object'; })[0];
    value = arrKey && ks0.length <= 3 ? value[arrKey] : [value];
  }
  if (!Array.isArray(value)) throw new Error('Expected a JSON array (of objects or of arrays).');
  var flat = opts.flatten !== false;
  function flatten(o, pre, out) {
    Object.keys(o).forEach(function (k) {
      var v = o[k], key = pre ? pre + '.' + k : k;
      if (flat && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, key, out); else out[key] = v;
    });
    return out;
  }
  if (value.every(function (r) { return Array.isArray(r); })) {
    value.forEach(function (r) { lines.push(r.map(function (c) { return csvQuote(csvCell(c), d, opts.quoteAll); }).join(d)); });
    return lines.join(eol) + (lines.length ? eol : '');
  }
  var rows = value.map(function (r) { return r && typeof r === 'object' && !Array.isArray(r) ? flatten(r, '', {}) : { value: r }; });
  var keys = [], seen = {};
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } }); });
  if (opts.header !== false) lines.push(keys.map(function (k) { return csvQuote(k, d, opts.quoteAll); }).join(d));
  rows.forEach(function (r) { lines.push(keys.map(function (k) { return csvQuote(csvCell(r[k]), d, opts.quoteAll); }).join(d)); });
  return lines.join(eol) + eol;
};
/* ---------------- Subnet / CIDR calculator ---------------- */
T.ip4Parse = function (s) {
  s = String(s).trim();
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) throw new Error('"' + s + '" is not a valid IPv4 address (expected four numbers like 192.168.1.10).');
  var n = 0;
  for (var k = 1; k <= 4; k++) {
    if (m[k].length > 1 && m[k][0] === '0') throw new Error('"' + s + '": leading zeros are ambiguous (some tools read them as octal). Write ' + m.slice(1).map(function (x) { return +x; }).join('.') + '.');
    var v = +m[k]; if (v > 255) throw new Error('"' + s + '": each part must be 0-255, got ' + v + '.');
    n = n * 256 + v;
  }
  return n;
};
T.ip4Str = function (n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); };
function ip4Mask(p) { return p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0; }
function ip4Bin(n) { var b = ('0'.repeat(32) + n.toString(2)).slice(-32); return b.slice(0, 8) + '.' + b.slice(8, 16) + '.' + b.slice(16, 24) + '.' + b.slice(24); }
T.ip4MaskToPrefix = function (s) {
  var n = T.ip4Parse(s), p = 0;
  while (p < 32 && (n & (0x80000000 >>> p))) p++;
  if (ip4Mask(p) !== n) {
    var inv = (~n) >>> 0, q = 0; while (q < 32 && (inv & (0x80000000 >>> q))) q++;
    if (ip4Mask(q) === inv) return { prefix: q, wildcard: true };
    throw new Error(s + ' is not a valid netmask (the 1 bits must be contiguous, e.g. 255.255.255.0).');
  }
  return { prefix: p };
};
function ip4Type(n) {
  var R = [['0.0.0.0', 8, 'This network (0.0.0.0/8)'], ['10.0.0.0', 8, 'Private (RFC 1918)'], ['100.64.0.0', 10, 'Carrier-grade NAT / shared (RFC 6598)'], ['127.0.0.0', 8, 'Loopback'],
    ['169.254.0.0', 16, 'Link-local (APIPA)'], ['172.16.0.0', 12, 'Private (RFC 1918)'], ['192.0.0.0', 24, 'IETF protocol assignments'], ['192.0.2.0', 24, 'Documentation (TEST-NET-1)'],
    ['192.88.99.0', 24, 'Reserved (6to4 relay)'], ['192.168.0.0', 16, 'Private (RFC 1918)'], ['198.18.0.0', 15, 'Benchmarking (RFC 2544)'], ['198.51.100.0', 24, 'Documentation (TEST-NET-2)'],
    ['203.0.113.0', 24, 'Documentation (TEST-NET-3)'], ['224.0.0.0', 4, 'Multicast'], ['255.255.255.255', 32, 'Limited broadcast'], ['240.0.0.0', 4, 'Reserved (class E)']];
  for (var k = 0; k < R.length; k++) { var b = T.ip4Parse(R[k][0]), m = ip4Mask(R[k][1]); if (((n & m) >>> 0) === b) return R[k][2]; }
  return 'Public (globally routable)';
}
// Accepts "10.0.0.5/24", "10.0.0.5 255.255.255.0", "10.0.0.5/255.255.255.0" or a bare address (/32).
T.cidrParse = function (s) {
  s = String(s).trim();
  var m = /^([\d.]+)\s*(?:\/\s*(\d{1,2})|[\/\s]\s*([\d.]+))?$/.exec(s);
  if (!m) throw new Error('Enter an IPv4 network like 192.168.1.0/24 or 10.0.0.5 255.255.255.0.');
  var ip = T.ip4Parse(m[1]), p = 32;
  if (m[2] !== undefined) { p = +m[2]; if (p > 32) throw new Error('The prefix length must be between 0 and 32.'); }
  else if (m[3] !== undefined) p = T.ip4MaskToPrefix(m[3]).prefix;
  return { ip: ip, prefix: p };
};
T.cidrInfo = function (s) {
  var c = typeof s === 'string' ? T.cidrParse(s) : s, p = c.prefix, mask = ip4Mask(p), net = (c.ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
  var total = Math.pow(2, 32 - p), first, last, usable;
  if (p === 32) { first = last = net; usable = 1; }
  else if (p === 31) { first = net; last = bc; usable = 2; }
  else { first = net + 1; last = bc - 1; usable = total - 2; }
  var o1 = net >>> 24;
  return {
    input: T.ip4Str(c.ip) + '/' + p, prefix: p, address: T.ip4Str(c.ip), network: T.ip4Str(net), broadcast: p >= 31 ? null : T.ip4Str(bc), netmask: T.ip4Str(mask),
    wildcard: T.ip4Str(~mask >>> 0), first: T.ip4Str(first), last: T.ip4Str(last), total: total, usable: usable, cidr: T.ip4Str(net) + '/' + p,
    hostBitsSet: c.ip !== net, type: ip4Type(c.ip), cls: o1 < 128 ? 'A' : o1 < 192 ? 'B' : o1 < 224 ? 'C' : o1 < 240 ? 'D (multicast)' : 'E (reserved)',
    binMask: ip4Bin(mask), binAddr: ip4Bin(c.ip), hex: '0x' + ('00000000' + c.ip.toString(16)).slice(-8), int: c.ip, netInt: net, bcInt: bc,
    ptr: p % 8 === 0 && p > 0 ? T.ip4Str(net).split('.').slice(0, p / 8).reverse().join('.') + '.in-addr.arpa' : null
  };
};
T.cidrContains = function (cidr, ip) {
  var c = T.cidrInfo(cidr), n = typeof ip === 'number' ? ip : T.ip4Parse(ip);
  return n >= c.netInt && n <= c.bcInt;
};
T.cidrSplit = function (cidr, newPrefix, max) {
  var c = T.cidrInfo(cidr), np = +newPrefix;
  if (!(np >= c.prefix && np <= 32)) throw new Error('The new prefix must be between /' + c.prefix + ' and /32.');
  var count = Math.pow(2, np - c.prefix), size = Math.pow(2, 32 - np), out = [];
  for (var k = 0; k < count && k < (max || 256); k++) out.push(T.cidrInfo({ ip: c.netInt + k * size, prefix: np }));
  return { count: count, size: size, subnets: out };
};
// Do two networks overlap? Useful for VPN / Docker / Kubernetes address conflicts.
T.cidrOverlap = function (a, b) { var x = T.cidrInfo(a), y = T.cidrInfo(b); return x.netInt <= y.bcInt && y.netInt <= x.bcInt; };

/* IPv6 */
T.ip6Parse = function (s) {
  s = String(s).trim().replace(/^\[|\]$/g, '');
  var zone = '', zi = s.indexOf('%'); if (zi >= 0) { zone = s.slice(zi); s = s.slice(0, zi); }
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.indexOf(':') < 0) throw new Error('"' + s + '" is not a valid IPv6 address.');
  var v4 = null, m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { v4 = T.ip4Parse(m[2]); s = m[1] + (v4 >>> 16).toString(16) + ':' + (v4 & 0xffff).toString(16); }
  var dbl = s.split('::');
  if (dbl.length > 2) throw new Error('"::" may appear only once in an IPv6 address.');
  function groups(x) { return x === '' ? [] : x.split(':'); }
  var head = groups(dbl[0]), tail = dbl.length === 2 ? groups(dbl[1]) : [];
  var all = head.concat(tail);
  if (all.some(function (g) { return !/^[0-9a-fA-F]{1,4}$/.test(g); })) throw new Error('Each IPv6 group must be 1-4 hex digits.');
  var missing = 8 - all.length;
  if (dbl.length === 2 ? missing < 1 : missing !== 0) throw new Error(dbl.length === 2 ? 'Too many groups for "::" to stand for.' : 'An IPv6 address needs 8 groups (or "::" for a run of zeros).');
  var full = head.concat(new Array(dbl.length === 2 ? missing : 0).fill('0'), tail), n = BigInt(0);
  full.forEach(function (g) { n = (n << BigInt(16)) | BigInt(parseInt(g, 16)); });
  return { n: n, zone: zone };
};
function ip6Groups(n) { var g = []; for (var k = 7; k >= 0; k--) g.push(Number((n >> BigInt(16 * k)) & BigInt(0xffff))); return g; }
T.ip6Expand = function (n) { return ip6Groups(n).map(function (g) { return ('000' + g.toString(16)).slice(-4); }).join(':'); };
T.ip6Compress = function (n) {
  var g = ip6Groups(n), bs = -1, bl = 0;
  for (var k = 0; k < 8;) { if (g[k] === 0) { var j = k; while (j < 8 && g[j] === 0) j++; if (j - k > bl) { bs = k; bl = j - k; } k = j; } else k++; }
  var h = g.map(function (x) { return x.toString(16); });
  if (bl < 2) return h.join(':');
  return h.slice(0, bs).join(':') + '::' + h.slice(bs + bl).join(':');
};
function ip6Type(n) {
  var R = [['::1', 128, 'Loopback'], ['::', 128, 'Unspecified'], ['::ffff:0:0', 96, 'IPv4-mapped'], ['64:ff9b::', 96, 'IPv4/IPv6 translation (NAT64)'], ['2001:db8::', 32, 'Documentation'],
    ['2001::', 32, 'Teredo'], ['2002::', 16, '6to4'], ['fe80::', 10, 'Link-local'], ['fc00::', 7, 'Unique local (ULA, private)'], ['ff00::', 8, 'Multicast'], ['2000::', 3, 'Global unicast']];
  for (var k = 0; k < R.length; k++) { var b = T.ip6Parse(R[k][0]).n, sh = BigInt(128 - R[k][1]); if ((n >> sh) === (b >> sh)) return R[k][2]; }
  return 'Reserved';
}
T.ip6Info = function (s) {
  s = String(s).trim();
  var m = /^(.*?)(?:\/(\d{1,3}))?$/.exec(s), a = T.ip6Parse(m[1]), p = m[2] === undefined ? 128 : +m[2];
  if (p > 128) throw new Error('The IPv6 prefix length must be between 0 and 128.');
  var ALL = (BigInt(1) << BigInt(128)) - BigInt(1), host = p === 128 ? BigInt(0) : (BigInt(1) << BigInt(128 - p)) - BigInt(1), net = a.n & (ALL ^ host), last = net | host;
  var total = BigInt(1) << BigInt(128 - p);
  return { address: T.ip6Compress(a.n) + a.zone, expanded: T.ip6Expand(a.n), prefix: p, network: T.ip6Compress(net) + '/' + p, first: T.ip6Compress(net), last: T.ip6Compress(last),
    firstExpanded: T.ip6Expand(net), lastExpanded: T.ip6Expand(last), total: total.toString(), totalPow: '2^' + (128 - p), type: ip6Type(a.n), n: a.n,
    hostBitsSet: (a.n & host) !== BigInt(0),
    ptr: T.ip6Expand(a.n).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa' };
};
/* ---------------- docker run -> compose ---------------- */
// value-taking flags: flag -> compose handler name
var DR_VAL = { '-p': 'ports', '--publish': 'ports', '-v': 'volumes', '--volume': 'volumes', '--mount': 'mount', '-e': 'env', '--env': 'env', '--env-file': 'env_file',
  '--name': 'name', '--restart': 'restart', '--network': 'network', '--net': 'network', '--network-alias': 'alias', '--net-alias': 'alias', '-w': 'working_dir',
  '--workdir': 'working_dir', '-u': 'user', '--user': 'user', '--entrypoint': 'entrypoint', '-h': 'hostname', '--hostname': 'hostname', '--add-host': 'extra_hosts',
  '--dns': 'dns', '--dns-search': 'dns_search', '-l': 'labels', '--label': 'labels', '--cpus': 'cpus', '-m': 'mem_limit', '--memory': 'mem_limit',
  '--memory-reservation': 'mem_reservation', '--memory-swap': 'memswap_limit', '--shm-size': 'shm_size', '--cap-add': 'cap_add', '--cap-drop': 'cap_drop',
  '--device': 'devices', '--log-driver': 'log_driver', '--log-opt': 'log_opt', '--ulimit': 'ulimits', '--sysctl': 'sysctls', '--tmpfs': 'tmpfs', '--platform': 'platform',
  '--pull': 'pull_policy', '--health-cmd': 'hc_test', '--health-interval': 'hc_interval', '--health-retries': 'hc_retries', '--health-timeout': 'hc_timeout',
  '--health-start-period': 'hc_start_period', '--gpus': 'gpus', '--ipc': 'ipc', '--pid': 'pid', '--stop-signal': 'stop_signal', '--stop-timeout': 'stop_grace_period',
  '--security-opt': 'security_opt', '--expose': 'expose', '--link': 'links', '--group-add': 'group_add', '--runtime': 'runtime', '--mac-address': 'mac_address',
  '--ip': 'ip', '--ip6': 'ip6', '--userns': 'userns_mode', '--uts': 'uts', '--cgroup-parent': 'cgroup_parent', '--cpu-shares': 'cpu_shares', '-c': 'cpu_shares',
  '--cpuset-cpus': 'cpuset', '--pids-limit': 'pids_limit', '--oom-score-adj': 'oom_score_adj', '--volumes-from': 'volumes_from', '--label-file': 'label_file',
  '--attach': 'ignore', '-a': 'ignore', '--cidfile': 'ignore', '--detach-keys': 'ignore', '--storage-opt': 'storage_opt', '--device-cgroup-rule': 'device_cgroup_rules',
  '--isolation': 'isolation', '--domainname': 'domainname', '--cgroupns': 'cgroup', '--blkio-weight': 'blkio', '--cpu-period': 'cpu_period', '--cpu-quota': 'cpu_quota' };
var DR_BOOL = { '-d': 'detach', '--detach': 'detach', '-i': 'stdin_open', '--interactive': 'stdin_open', '-t': 'tty', '--tty': 'tty', '--rm': 'rm', '--privileged': 'privileged',
  '--init': 'init', '--read-only': 'read_only', '-P': 'publish_all', '--publish-all': 'publish_all', '--no-healthcheck': 'no_healthcheck', '-q': 'ignore', '--quiet': 'ignore',
  '--sig-proxy': 'ignore', '--oom-kill-disable': 'oom_kill_disable' };

function yq(s) {
  s = String(s);
  if (s === '') return '""';
  if (/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(s) || /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^0[xo][0-9a-f]+$/i.test(s) || /^[\d:]+$/.test(s)) return JSON.stringify(s);
  if (/^[A-Za-z0-9_.\/~$][A-Za-z0-9_.\/~$@%+=:-]*$/.test(s) && !/:$/.test(s)) return s;
  return JSON.stringify(s);
}
T.yamlQuote = yq;
function yflow(arr) { return '[' + arr.map(function (x) { return JSON.stringify(x); }).join(', ') + ']'; }
function drServiceName(name, image) {
  var s = name || (image || 'app').replace(/@.*$/, '').split('/').pop().replace(/:.*$/, '');
  s = s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+|[-.]+$/g, '');
  return s || 'app';
}
function drDur(v) { return /^\d+$/.test(v) ? v + 's' : v; }

T.dockerRunParse = function (text) {
  var words = T.shellSplit(String(text).trim().replace(/^\$\s+/, '')), cmds = [], cur = null, warnings = [];
  for (var k = 0; k < words.length; k++) {
    var w = words[k];
    if (typeof w !== 'string') { if (cur) { cmds.push(cur); cur = null; } continue; }
    if (cur) { cur.push(w); continue; }
    if (/(^|\/)(docker|podman)(\.exe)?$/.test(w) || w === 'sudo') {
      var j = k + (w === 'sudo' ? 1 : 0);
      if (w === 'sudo' && !/docker|podman/.test(words[j] || '')) continue;
      var a1 = words[j + 1], a2 = words[j + 2];
      if (a1 === 'run') { cur = []; k = j + 1; } else if (a1 === 'container' && (a2 === 'run' || a2 === 'create')) { cur = []; k = j + 2; } else if (a1 === 'create') { cur = []; k = j + 1; }
    }
  }
  if (cur) cmds.push(cur);
  if (!cmds.length) throw new Error('No "docker run" command found. Paste a command like: docker run -d -p 8080:80 nginx');
  var services = cmds.map(function (args) { return drParseOne(args, warnings); });
  return { services: services, warnings: warnings };
};

function drParseOne(args, warnings) {
  var s = { opts: {}, lists: {}, image: null, command: [] };
  function addList(key, v) { (s.lists[key] = s.lists[key] || []).push(v); }
  for (var i = 0; i < args.length; i++) {
    var a = args[i], flag = null, val = null;
    if (a === '--') { i++; a = args[i]; if (a === undefined) break; }
    else if (/^--[a-z]/.test(a)) {
      var eq = a.indexOf('=');
      flag = eq > 0 ? a.slice(0, eq) : a;
      if (DR_VAL[flag]) { val = eq > 0 ? a.slice(eq + 1) : args[++i]; if (val === undefined) throw new Error(flag + ' needs a value.'); }
      else if (DR_BOOL[flag]) { val = eq > 0 ? a.slice(eq + 1) : 'true'; if (/^false$/i.test(val)) continue; }
      else { warnings.push('Unknown option ' + flag + ' was skipped.'); if (eq < 0 && args[i + 1] && args[i + 1].charAt(0) !== '-' && false) i++; continue; }
      drApply(s, flag, val, warnings, addList); continue;
    } else if (/^-[A-Za-z]/.test(a)) {
      for (var j = 1; j < a.length; j++) {
        var f = '-' + a[j];
        if (DR_VAL[f]) { val = a.slice(j + 1).replace(/^=/, '') || args[++i]; if (val === undefined) throw new Error(f + ' needs a value.'); drApply(s, f, val, warnings, addList); break; }
        if (DR_BOOL[f]) { drApply(s, f, 'true', warnings, addList); continue; }
        warnings.push('Unknown option ' + f + ' was skipped.');
      }
      continue;
    }
    s.image = a; s.command = args.slice(i + 1); break;
  }
  if (!s.image) throw new Error('No image name found after the options.');
  return s;
}

function drApply(s, flag, v, warnings, addList) {
  var h = DR_VAL[flag] || DR_BOOL[flag], o = s.opts;
  switch (h) {
    case 'ports': case 'volumes': case 'env': case 'env_file': case 'extra_hosts': case 'dns': case 'dns_search': case 'labels': case 'cap_add': case 'cap_drop': case 'devices':
    case 'log_opt': case 'ulimits': case 'sysctls': case 'tmpfs': case 'security_opt': case 'expose': case 'links': case 'group_add': case 'alias': case 'mount':
    case 'volumes_from': case 'storage_opt': case 'device_cgroup_rules': case 'label_file': case 'network':
      addList(h, v); break;
    case 'ignore': break;
    default: o[h] = v;
  }
}

T.dockerRunToCompose = function (text) {
  var p = T.dockerRunParse(text), W = p.warnings.slice(), L = ['services:'], topNet = {}, topVol = {}, names = {};
  var dollar = false;
  function esc$(x) { if (/\$/.test(x)) { dollar = true; } return x; }
  p.services.forEach(function (s) {
    var o = s.opts, li = s.lists, name = drServiceName(o.name, s.image), base = name, n = 2;
    while (names[name]) name = base + '-' + n++;
    names[name] = 1;
    var S = [];
    function kv(k, v) { S.push('    ' + k + ': ' + v); }
    function list(k, arr, q) { if (!arr || !arr.length) return; S.push('    ' + k + ':'); arr.forEach(function (x) { S.push('      - ' + (q ? JSON.stringify(x) : yq(x))); }); }
    kv('image', yq(s.image));
    if (o.name) kv('container_name', yq(o.name));
    if (o.platform) kv('platform', yq(o.platform));
    if (o.pull_policy) kv('pull_policy', yq(o.pull_policy === 'missing' ? 'missing' : o.pull_policy));
    if (o.restart) kv('restart', yq(o.restart));
    if (o.entrypoint !== undefined) kv('entrypoint', o.entrypoint === '' ? '[""]' : yflow([o.entrypoint]));
    if (s.command.length) kv('command', yflow(s.command.map(function (c) { return /\$/.test(c) ? (dollar = true, c.replace(/\$/g, '$$$$')) : c; })));
    if (o.working_dir) kv('working_dir', yq(o.working_dir));
    if (o.user) kv('user', JSON.stringify(o.user));
    if (o.hostname) kv('hostname', yq(o.hostname));
    if (o.domainname) kv('domainname', yq(o.domainname));
    if (li.ports) list('ports', li.ports, true);
    if (li.expose) list('expose', li.expose, true);
    // volumes (short syntax) and --mount (long syntax)
    var vols = (li.volumes || []).map(function (v) {
      var parts = v.split(':'), src = parts[0];
      if (/^[A-Za-z]$/.test(src) && parts.length > 2) { src = parts[0] + ':' + parts[1]; parts = [src].concat(parts.slice(2)); } // Windows C:\path
      if (parts.length === 1) return { s: v, note: 'anonymous' };
      var src2 = src.replace(/^(\$\(pwd\)|\$\{?PWD\}?|`pwd`|%cd%|\$\{pwd\})(?=\/|\\|$)/, '.');
      if (src2 !== src) { if (src2 === '.') src2 = '.'; parts[0] = src2; }
      if (!/^[.\/~$\\]|^[A-Za-z]:/.test(parts[0])) topVol[parts[0]] = 1;
      return { s: parts.join(':') };
    });
    var mounts = (li.mount || []).map(function (m) {
      var kvs = {}; m.split(',').forEach(function (x) { var e = x.indexOf('='); kvs[e < 0 ? x : x.slice(0, e)] = e < 0 ? 'true' : x.slice(e + 1); });
      return kvs;
    });
    if (vols.length || mounts.length) {
      S.push('    volumes:');
      vols.forEach(function (v) { S.push('      - ' + yq(v.s)); });
      mounts.forEach(function (m) {
        var type = m.type || 'volume', src = m.source || m.src, dst = m.target || m.destination || m.dst;
        if (src && type === 'bind') src = src.replace(/^(\$\(pwd\)|\$\{?PWD\}?|`pwd`)(?=\/|$)/, '.');
        S.push('      - type: ' + type);
        if (src) S.push('        source: ' + yq(src));
        if (dst) S.push('        target: ' + yq(dst));
        if (m.readonly || m.ro) S.push('        read_only: true');
        if (type === 'volume' && src) topVol[src] = 1;
        if (m['bind-propagation']) S.push('        bind:', '          propagation: ' + yq(m['bind-propagation']));
        if (m['volume-nocopy']) S.push('        volume:', '          nocopy: true');
        if (m['tmpfs-size']) S.push('        tmpfs:', '          size: ' + yq(m['tmpfs-size']));
      });
    }
    if (li.volumes_from) list('volumes_from', li.volumes_from);
    if (li.tmpfs) list('tmpfs', li.tmpfs);
    if (li.env) {
      S.push('    environment:');
      li.env.forEach(function (e) {
        var eqi = e.indexOf('=');
        if (eqi < 0) { S.push('      - ' + yq(e)); return; }
        var val = e.slice(eqi + 1);
        if (/\$/.test(val)) { dollar = true; val = val.replace(/\$/g, '$$$$'); }
        S.push('      ' + yq(e.slice(0, eqi)) + ': ' + yq(val));
      });
      // the "- KEY" form and "KEY: value" form can't be mixed in one block
      var block = S.slice(S.lastIndexOf('    environment:') + 1);
      if (block.some(function (l) { return /^      - /.test(l); }) && block.some(function (l) { return !/^      - /.test(l); })) {
        var start = S.lastIndexOf('    environment:') + 1;
        S.splice(start, block.length);
        li.env.forEach(function (e) { var eqi = e.indexOf('='); var x = eqi < 0 ? e : e.slice(0, eqi + 1) + e.slice(eqi + 1).replace(/\$/g, '$$$$'); S.push('      - ' + yq(x)); });
      }
    }
    if (li.env_file) list('env_file', li.env_file);
    // networking
    var nets = li.network || [];
    var mode = nets.filter(function (x) { return /^(host|none|bridge|default)$|^(container|service|ns):/.test(x); })[0];
    var custom = nets.filter(function (x) { return x !== mode; }).map(function (x) { return x.split(',')[0].replace(/^name=/, ''); });
    if (mode && mode !== 'bridge' && mode !== 'default') kv('network_mode', JSON.stringify(mode.replace(/^container:/, 'container:')));
    if (mode === 'bridge') W.push('--network bridge is Docker\'s default network: Compose instead puts services on a project network named <project>_default, where they can reach each other by service name.');
    if (custom.length) {
      if (li.alias || o.ip || o.ip6) {
        S.push('    networks:');
        custom.forEach(function (nn, idx) {
          S.push('      ' + yq(nn) + ':');
          if (idx === 0 && li.alias) { S.push('        aliases:'); li.alias.forEach(function (a) { S.push('          - ' + yq(a)); }); }
          if (idx === 0 && o.ip) S.push('        ipv4_address: ' + yq(o.ip));
          if (idx === 0 && o.ip6) S.push('        ipv6_address: ' + yq(o.ip6));
        });
      } else list('networks', custom);
      custom.forEach(function (nn) { topNet[nn] = 1; });
    } else if (li.alias || o.ip) W.push('--network-alias / --ip only work on a user-defined network: add one under "networks:".');
    if (li.links) { list('links', li.links); W.push('--link is legacy: on a Compose network every service can already reach the others by service name.'); }
    if (li.extra_hosts) list('extra_hosts', li.extra_hosts.map(function (x) { return x.replace(/^([^:]+):/, '$1:'); }), true);
    if (li.dns) list('dns', li.dns);
    if (li.dns_search) list('dns_search', li.dns_search);
    if (o.mac_address) kv('mac_address', JSON.stringify(o.mac_address));
    if (o.stdin_open) kv('stdin_open', 'true');
    if (o.tty) kv('tty', 'true');
    if (o.privileged) kv('privileged', 'true');
    if (o.init) kv('init', 'true');
    if (o.read_only) kv('read_only', 'true');
    if (o.ipc) kv('ipc', yq(o.ipc));
    if (o.pid) kv('pid', yq(o.pid));
    if (o.uts) kv('uts', yq(o.uts));
    if (o.userns_mode) kv('userns_mode', yq(o.userns_mode));
    if (o.cgroup) kv('cgroup', yq(o.cgroup));
    if (o.cgroup_parent) kv('cgroup_parent', yq(o.cgroup_parent));
    if (o.isolation) kv('isolation', yq(o.isolation));
    if (o.runtime) kv('runtime', yq(o.runtime));
    if (li.cap_add) list('cap_add', li.cap_add);
    if (li.cap_drop) list('cap_drop', li.cap_drop);
    if (li.security_opt) list('security_opt', li.security_opt);
    if (li.devices) list('devices', li.devices);
    if (li.device_cgroup_rules) list('device_cgroup_rules', li.device_cgroup_rules, true);
    if (li.group_add) list('group_add', li.group_add, true);
    if (o.cpus) kv('cpus', JSON.stringify(o.cpus).replace(/"/g, '') === o.cpus && /^\d+(\.\d+)?$/.test(o.cpus) ? o.cpus : yq(o.cpus));
    if (o.cpu_shares) kv('cpu_shares', /^\d+$/.test(o.cpu_shares) ? o.cpu_shares : yq(o.cpu_shares));
    if (o.cpu_period) kv('cpu_period', yq(o.cpu_period));
    if (o.cpu_quota) kv('cpu_quota', yq(o.cpu_quota));
    if (o.cpuset) kv('cpuset', JSON.stringify(o.cpuset));
    if (o.mem_limit) kv('mem_limit', yq(o.mem_limit));
    if (o.mem_reservation) kv('mem_reservation', yq(o.mem_reservation));
    if (o.memswap_limit) kv('memswap_limit', yq(o.memswap_limit));
    if (o.shm_size) kv('shm_size', yq(o.shm_size));
    if (o.pids_limit) kv('pids_limit', /^-?\d+$/.test(o.pids_limit) ? o.pids_limit : yq(o.pids_limit));
    if (o.oom_score_adj) kv('oom_score_adj', o.oom_score_adj);
    if (o.oom_kill_disable) kv('oom_kill_disable', 'true');
    if (o.blkio) S.push('    blkio_config:', '      weight: ' + o.blkio);
    if (li.ulimits) {
      S.push('    ulimits:');
      li.ulimits.forEach(function (u) {
        var m = /^([a-z]+)=(-?\d+)(?::(-?\d+))?$/.exec(u);
        if (!m) { W.push('Could not convert --ulimit ' + u); return; }
        if (m[3] === undefined) S.push('      ' + m[1] + ': ' + m[2]);
        else S.push('      ' + m[1] + ':', '        soft: ' + m[2], '        hard: ' + m[3]);
      });
    }
    if (li.sysctls) { S.push('    sysctls:'); li.sysctls.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    if (li.storage_opt) { S.push('    storage_opt:'); li.storage_opt.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    if (li.labels) {
      S.push('    labels:');
      li.labels.forEach(function (x) { var e = x.indexOf('='); S.push('      ' + yq(e < 0 ? x : x.slice(0, e)) + ': ' + yq(e < 0 ? '' : x.slice(e + 1).replace(/\$/g, function () { dollar = true; return '$$'; }))); });
    }
    if (li.label_file) W.push('--label-file is not supported by Compose: copy the labels into "labels:".');
    if (o.log_driver || li.log_opt) {
      S.push('    logging:');
      if (o.log_driver) S.push('      driver: ' + yq(o.log_driver));
      if (li.log_opt) { S.push('      options:'); li.log_opt.forEach(function (x) { var e = x.indexOf('='); S.push('        ' + yq(x.slice(0, e)) + ': ' + yq(x.slice(e + 1))); }); }
    }
    if (o.no_healthcheck) S.push('    healthcheck:', '      disable: true');
    else if (o.hc_test || o.hc_interval || o.hc_retries || o.hc_timeout || o.hc_start_period) {
      S.push('    healthcheck:');
      if (o.hc_test) S.push('      test: ' + yflow(['CMD-SHELL', o.hc_test.replace(/\$/g, function () { dollar = true; return '$$'; })]));
      if (o.hc_interval) S.push('      interval: ' + yq(drDur(o.hc_interval)));
      if (o.hc_timeout) S.push('      timeout: ' + yq(drDur(o.hc_timeout)));
      if (o.hc_retries) S.push('      retries: ' + o.hc_retries);
      if (o.hc_start_period) S.push('      start_period: ' + yq(drDur(o.hc_start_period)));
    }
    if (o.stop_signal) kv('stop_signal', yq(o.stop_signal));
    if (o.stop_grace_period) kv('stop_grace_period', yq(drDur(o.stop_grace_period)));
    if (o.gpus) {
      var g = o.gpus.replace(/^"|"$/g, ''), cm = /^(all|\d+)$/.exec(g), dm = /device=([\d,]+)/.exec(g);
      S.push('    deploy:', '      resources:', '        reservations:', '          devices:', '            - driver: nvidia');
      if (dm) S.push('              device_ids: ' + yflow(dm[1].split(',')));
      else S.push('              count: ' + (cm ? cm[1] : 'all'));
      S.push('              capabilities: [gpu]');
    }
    if (o.rm) W.push('--rm has no Compose equivalent for services: "docker compose down" removes the containers. For one-off tasks use "docker compose run --rm ' + name + '".');
    if (o.detach) W.push('-d is not part of the file: start the stack in the background with "docker compose up -d".');
    if (o.publish_all) W.push('-P (publish all exposed ports to random host ports) has no direct Compose equivalent: list the ports under "ports:" (e.g. "- \\"80\\"" picks a random host port).');
    if (li.ports && li.ports.some(function (x) { return /^\d+:\d+$/.test(x) && +x.split(':')[1] < 60; })) W.push('Ports are written in quotes on purpose: unquoted values like 22:22 are read by YAML 1.1 parsers as base-60 numbers (22:22 becomes 1342).');
    L.push('  ' + name + ':');
    L.push.apply(L, S);
  });
  if (dollar) W.push('Every "$" in a value was doubled to "$$": Compose would otherwise treat it as a ${VARIABLE} to substitute from your shell or .env file.');
  var nk = Object.keys(topNet);
  if (nk.length) { L.push('', 'networks:'); nk.forEach(function (x) { L.push('  ' + yq(x) + ':', '    external: true'); }); W.push('The network' + (nk.length > 1 ? 's ' : ' ') + nk.join(', ') + ' marked "external: true" must already exist (docker network create ' + nk[0] + '). Remove "external: true" to let Compose create and manage it.'); }
  var vk = Object.keys(topVol);
  if (vk.length) { L.push('', 'volumes:'); vk.forEach(function (x) { L.push('  ' + yq(x) + ':'); }); W.push('Named volume' + (vk.length > 1 ? 's ' : ' ') + vk.join(', ') + ' will be created as <project>_' + vk[0] + '. To reuse the existing volume from docker run, add "external: true" under it.'); }
  W = W.filter(function (w, k) { return W.indexOf(w) === k; });
  return { yaml: L.join('\n') + '\n', warnings: W, count: p.services.length };
};
if (typeof module !== 'undefined' && module.exports) module.exports = T;
if (typeof document === 'undefined') return;

/* ======================= UI ======================= */
function $(root, sel) { return root.querySelector(sel); }
function on(el, ev, fn) { el.addEventListener(ev, fn); }
function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
function msg(el, cls, html) { el.className = 'msg ' + cls; el.innerHTML = html; el.hidden = !html; }
function copyBtn(btn, getText) {
  on(btn, 'click', function () { navigator.clipboard.writeText(getText()).then(function () { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1200); }); });
}
function fmtLocal(d) { return d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }); }
function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch (e) { return 'local time'; } }

var UI = {};

UI.json = function (r) {
  var inp = $(r, '#json-in'), out = $(r, '#json-out'), m = $(r, '#json-msg'), ctx = $(r, '#json-ctx');
  function check(action) {
    var text = inp.value;
    ctx.hidden = true;
    if (!text.trim()) { msg(m, '', ''); if (action) out.value = ''; return; }
    var res = T.jsonCheck(text);
    if (res.ok) {
      msg(m, 'ok', '✓ Valid JSON');
      if (action) {
        var ind = $(r, '#json-indent').value;
        out.value = T.jsonFormat(res.value, action === 'min' ? 0 : (ind === 'tab' ? '\t' : +ind), $(r, '#json-sort').checked);
      }
      return;
    }
    msg(m, 'bad', '✗ Invalid JSON at <b>line ' + res.line + ', column ' + res.col + '</b>: ' + esc(res.message) +
      (res.native && res.native !== res.message ? '<br><small>Browser says: ' + esc(res.native) + '</small>' : ''));
    var lines = text.split('\n'), L = res.line - 1, html = '';
    for (var k = Math.max(0, L - 2); k <= Math.min(lines.length - 1, L + 1); k++) {
      var num = String(k + 1).padStart(4, ' ') + ' | ';
      if (k === L) {
        var ln = lines[k], c = res.col - 1;
        html += '<span class="eline">' + esc(num) + esc(ln.slice(0, c)) + '<mark class="e">' + (esc(ln.charAt(c)) || '&nbsp;') + '</mark>' + esc(ln.slice(c + 1)) + '</span>\n';
        html += esc(' '.repeat(num.length + c)) + '^\n';
      } else html += esc(num + lines[k]) + '\n';
    }
    ctx.innerHTML = html; ctx.hidden = false;
    if (action) { out.value = ''; inp.focus(); inp.setSelectionRange(res.pos, Math.min(res.pos + 1, text.length)); }
  }
  on($(r, '#json-fmt'), 'click', function () { check('fmt'); });
  on($(r, '#json-min'), 'click', function () { check('min'); });
  on($(r, '#json-clear'), 'click', function () { inp.value = ''; out.value = ''; check(); });
  on($(r, '#json-sample'), 'click', function () { inp.value = '{\n  "name": "errorfix",\n  "tags": ["json", "tools"],\n  "nested": {"ok": true, "count": 3,}\n}'; check(); });
  copyBtn($(r, '#json-copy'), function () { return out.value; });
  on(inp, 'input', debounce(function () { check(); }, 250));
};

UI.cron = function (r) {
  var inp = $(r, '#cron-in'), d = $(r, '#cron-desc'), m = $(r, '#cron-msg'), nx = $(r, '#cron-next');
  function run() {
    var e = inp.value;
    try {
      d.textContent = T.describeCron(e) + '.';
      msg(m, '', '');
      var c = T.parseCron(e);
      if (c.reboot) { nx.innerHTML = '<li>Runs once at system startup, not on a schedule.</li>'; return; }
      var runs = T.cronNext(e, new Date(), 5);
      nx.innerHTML = runs.length ? runs.map(function (x) { return '<li>' + esc(fmtLocal(x)) + ' <small>(' + esc(T.relTime(x.getTime(), Date.now())) + ')</small></li>'; }).join('')
        : '<li>Never: no date in the next few years matches (e.g. 30 February).</li>';
      if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(e.trim()));
    } catch (err) { d.textContent = '—'; nx.innerHTML = ''; msg(m, 'bad', esc(err.message)); }
  }
  $(r, '#cron-tz').textContent = tz();
  r.querySelectorAll('[data-cron]').forEach(function (b) { on(b, 'click', function () { inp.value = b.getAttribute('data-cron'); run(); }); });
  if (location.hash.length > 1) { try { inp.value = decodeURIComponent(location.hash.slice(1)); } catch (e) {} }
  on(inp, 'input', run); run();
};

UI.chmod = function (r) {
  var oct = $(r, '#chmod-oct'), sym = $(r, '#chmod-sym'), m = $(r, '#chmod-msg'), boxes = r.querySelectorAll('input[type=checkbox]');
  function fromBoxes() {
    var v = [0, 0, 0, 0];
    boxes.forEach(function (b) { if (b.checked) v[+b.getAttribute('data-i')] += +b.getAttribute('data-v'); });
    return (v[0] ? String(v[0]) : '') + v[1] + v[2] + v[3];
  }
  function setAll(o, skip) {
    var s = T.octalToSymbolic(o), o4 = o.length === 3 ? '0' + o : o;
    boxes.forEach(function (b) { b.checked = !!(+o4[+b.getAttribute('data-i')] & +b.getAttribute('data-v')); });
    if (skip !== 'oct') oct.value = o;
    if (skip !== 'sym') sym.value = s;
    $(r, '#chmod-cmd').textContent = 'chmod ' + o + ' file';
    $(r, '#chmod-cmd2').textContent = 'chmod ' + T.chmodSymbolicArg(o) + ' file';
    $(r, '#chmod-ls').textContent = '-' + s;
    msg(m, '', '');
  }
  boxes.forEach(function (b) { on(b, 'change', function () { setAll(fromBoxes()); }); });
  on(oct, 'input', function () { try { setAll(oct.value.trim(), 'oct'); } catch (e) { msg(m, 'bad', esc(e.message)); } });
  on(sym, 'input', function () { try { setAll(T.symbolicToOctal(sym.value), 'sym'); } catch (e) { msg(m, 'bad', esc(e.message)); } });
  r.querySelectorAll('[data-mode]').forEach(function (b) { on(b, 'click', function () { setAll(b.getAttribute('data-mode')); }); });
  copyBtn($(r, '#chmod-copy'), function () { return $(r, '#chmod-cmd').textContent; });
  setAll('755');
};

UI.timestamp = function (r) {
  var inp = $(r, '#ts-in'), out = $(r, '#ts-out'), m = $(r, '#ts-msg'), din = $(r, '#ts-date'), dout = $(r, '#ts-dout'), dm = $(r, '#ts-dmsg');
  function tick() { var n = Date.now(); $(r, '#ts-now-s').textContent = Math.floor(n / 1000); $(r, '#ts-now-ms').textContent = n; $(r, '#ts-now-iso').textContent = new Date(n).toISOString(); }
  function row(k, v) { return '<tr><th>' + k + '</th><td><code>' + esc(v) + '</code></td></tr>'; }
  function conv() {
    var v = inp.value.trim().replace(/[_,\s]/g, '');
    if (!v) { out.innerHTML = ''; msg(m, '', ''); return; }
    if (!/^-?\d+(\.\d+)?$/.test(v)) { out.innerHTML = ''; msg(m, 'bad', 'Enter a number such as 1700000000 (seconds) or 1700000000000 (milliseconds).'); return; }
    var t = T.tsToMs(+v), d = new Date(t.ms);
    if (isNaN(d.getTime())) { out.innerHTML = ''; msg(m, 'bad', 'Out of range for a JavaScript date.'); return; }
    msg(m, '', '');
    out.innerHTML = row('Detected unit', t.unit) + row('ISO 8601 (UTC)', d.toISOString()) + row('UTC', d.toUTCString()) + row('Local (' + tz() + ')', fmtLocal(d)) +
      row('Relative', T.relTime(t.ms, Date.now())) + row('Seconds', String(Math.floor(t.ms / 1000))) + row('Milliseconds', String(Math.round(t.ms)));
  }
  function dconv() {
    var ms = T.parseDateInput(din.value, $(r, '#ts-utc').checked);
    if (!din.value.trim()) { dout.innerHTML = ''; msg(dm, '', ''); return; }
    if (isNaN(ms)) { dout.innerHTML = ''; msg(dm, 'bad', 'Could not parse that date. Try 2026-01-31 14:30:00 or an ISO string like 2026-01-31T14:30:00Z.'); return; }
    msg(dm, '', '');
    dout.innerHTML = row('Seconds', String(Math.floor(ms / 1000))) + row('Milliseconds', String(ms)) + row('ISO 8601 (UTC)', new Date(ms).toISOString()) + row('Local', fmtLocal(new Date(ms)));
  }
  on($(r, '#ts-usenow'), 'click', function () { inp.value = Math.floor(Date.now() / 1000); conv(); });
  on(inp, 'input', conv); on(din, 'input', dconv); on($(r, '#ts-utc'), 'change', dconv);
  var n = new Date(); din.value = n.getFullYear() + '-' + two(n.getMonth() + 1) + '-' + two(n.getDate()) + ' ' + two(n.getHours()) + ':' + two(n.getMinutes()) + ':00';
  $(r, '#ts-tz').textContent = tz();
  tick(); setInterval(tick, 1000); inp.value = Math.floor(Date.now() / 1000); conv(); dconv();
};

UI.base64 = function (r) {
  var inp = $(r, '#b64-in'), out = $(r, '#b64-out'), m = $(r, '#b64-msg');
  function enc() { out.value = T.b64encode(inp.value, $(r, '#b64-url').checked); msg(m, 'ok', 'Encoded ' + new TextEncoder().encode(inp.value).length + ' bytes (UTF-8) → ' + out.value.length + ' characters.'); }
  function dec() {
    try {
      var bytes = T.b64decodeBytes(inp.value), t = T.utf8Decode(bytes);
      out.value = t.text;
      msg(m, t.ok ? 'ok' : 'bad', t.ok ? 'Decoded ' + bytes.length + ' bytes of UTF-8 text.' : 'Decoded ' + bytes.length + ' bytes, but they are not valid UTF-8 text (probably binary data). First bytes (hex): <code>' + T.hex(bytes, 48) + '</code>');
    } catch (e) { out.value = ''; msg(m, 'bad', esc(e.message)); }
  }
  on($(r, '#b64-enc'), 'click', enc); on($(r, '#b64-dec'), 'click', dec);
  on($(r, '#b64-swap'), 'click', function () { var t = inp.value; inp.value = out.value; out.value = t; });
  copyBtn($(r, '#b64-copy'), function () { return out.value; });
};

UI.url = function (r) {
  var inp = $(r, '#url-in'), out = $(r, '#url-out'), m = $(r, '#url-msg'), q = $(r, '#qs-in'), qt = $(r, '#qs-out');
  on($(r, '#url-encc'), 'click', function () { out.value = encodeURIComponent(inp.value); msg(m, '', ''); });
  on($(r, '#url-enc'), 'click', function () { try { out.value = encodeURI(inp.value); msg(m, '', ''); } catch (e) { msg(m, 'bad', 'Cannot encode: the text contains a lone surrogate character.'); } });
  on($(r, '#url-dec'), 'click', function () { try { out.value = T.urlDecode(inp.value, $(r, '#url-plus').checked); msg(m, '', ''); } catch (e) { out.value = ''; msg(m, 'bad', esc(e.message)); } });
  on($(r, '#url-swap'), 'click', function () { var t = inp.value; inp.value = out.value; out.value = t; });
  copyBtn($(r, '#url-copy'), function () { return out.value; });
  function parse() {
    var s = q.value.trim(), html = '';
    if (!s) { qt.innerHTML = ''; return; }
    try {
      var u = new URL(s);
      html += '<tr><th colspan="2">URL parts</th></tr>' + [['protocol', u.protocol], ['host', u.host], ['pathname', u.pathname], ['hash', u.hash]].filter(function (x) { return x[1]; })
        .map(function (x) { return '<tr><td>' + x[0] + '</td><td><code>' + esc(x[1]) + '</code></td></tr>'; }).join('');
    } catch (e) {}
    var p = T.parseQuery(s);
    html += '<tr><th>Parameter</th><th>Decoded value</th></tr>' + (p.length ? p.map(function (x) { return '<tr><td><code>' + esc(x[0]) + '</code></td><td><code>' + esc(x[1]) + '</code></td></tr>'; }).join('') : '<tr><td colspan="2">No query parameters found.</td></tr>');
    qt.innerHTML = html;
  }
  on(q, 'input', parse); parse();
};

UI.jwt = function (r) {
  var inp = $(r, '#jwt-in'), m = $(r, '#jwt-msg'), h = $(r, '#jwt-h'), p = $(r, '#jwt-p'), c = $(r, '#jwt-claims'), res = $(r, '#jwt-res');
  var NAMES = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', exp: 'Expires', nbf: 'Not before', iat: 'Issued at', jti: 'JWT ID', auth_time: 'Authenticated at' };
  function run() {
    if (!inp.value.trim()) { res.hidden = true; msg(m, '', ''); return; }
    try {
      var j = T.jwtDecode(inp.value), now = Date.now() / 1000;
      h.textContent = JSON.stringify(j.header, null, 2); p.textContent = JSON.stringify(j.payload, null, 2);
      var st = T.jwtStatus(j.payload, now);
      msg(m, st.state === 'valid' ? 'ok' : st.state === 'noexp' ? '' : 'bad', esc(st.text) + (j.header.alg ? ' · algorithm <code>' + esc(j.header.alg) + '</code>' : '') + ' · signature <b>not verified</b>');
      var rows = '';
      Object.keys(NAMES).forEach(function (k) {
        if (!(k in j.payload)) return;
        var v = j.payload[k], extra = '';
        if (typeof v === 'number' && /^(exp|nbf|iat|auth_time)$/.test(k)) { var d = new Date(v * 1000); extra = '<br><small>' + esc(fmtLocal(d)) + ' · ' + esc(d.toISOString()) + ' · ' + esc(T.relTime(v * 1000, Date.now())) + '</small>'; }
        rows += '<tr><td><code>' + k + '</code> ' + NAMES[k] + '</td><td><code>' + esc(JSON.stringify(v)) + '</code>' + extra + '</td></tr>';
      });
      c.innerHTML = rows || '<tr><td>No registered claims (iss, sub, aud, exp, nbf, iat, jti).</td></tr>';
      res.hidden = false;
    } catch (e) { res.hidden = true; msg(m, 'bad', esc(e.message)); }
  }
  on($(r, '#jwt-sample'), 'click', function () {
    var n = Math.floor(Date.now() / 1000);
    inp.value = T.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), true) + '.' + T.b64encode(JSON.stringify({ sub: '1234567890', name: 'Jane Doe', role: 'admin', iat: n, exp: n + 3600 }), true) + '.' + 'c2lnbmF0dXJlLW5vdC1yZWFs';
    run();
  });
  on(inp, 'input', run);
};

UI.regex = function (r) {
  var pat = $(r, '#re-pat'), fl = $(r, '#re-flags'), txt = $(r, '#re-text'), m = $(r, '#re-msg'), hl = $(r, '#re-hl'), tb = $(r, '#re-table'), rep = $(r, '#re-rep'), ro = $(r, '#re-repout');
  function run() {
    var p = pat.value, f = fl.value.trim(), t = txt.value;
    if (!p) { hl.textContent = t; tb.innerHTML = ''; msg(m, '', ''); ro.textContent = ''; return; }
    var ms;
    try { ms = T.regexMatches(p, f, t, 1000); } catch (e) { msg(m, 'bad', esc(e.message)); hl.textContent = t; tb.innerHTML = ''; return; }
    msg(m, ms.length ? 'ok' : '', ms.length ? ms.length + (ms.length >= 1000 ? '+' : '') + ' match' + (ms.length > 1 ? 'es' : '') + (/[gy]/.test(f) ? '' : ' (add the g flag to find all matches)') : 'No matches');
    var html = '', last = 0;
    ms.forEach(function (x, k) { html += esc(t.slice(last, x.index)) + '<mark class="m' + (k % 2) + '">' + (x.text ? esc(x.text) : '<span class="zw"></span>') + '</mark>'; last = x.end; });
    hl.innerHTML = html + esc(t.slice(last)) + '\n';
    tb.innerHTML = ms.length ? '<tr><th>#</th><th>Index</th><th>Match</th><th>Groups</th></tr>' + ms.slice(0, 200).map(function (x, k) {
      var g = x.groups.map(function (v, i) { return '<code>$' + (i + 1) + '</code> ' + (v === undefined ? '<i>undefined</i>' : '<code>' + esc(v) + '</code>'); });
      if (x.named) Object.keys(x.named).forEach(function (n) { g.push('<code>' + esc(n) + '</code> ' + (x.named[n] === undefined ? '<i>undefined</i>' : '<code>' + esc(x.named[n]) + '</code>')); });
      return '<tr><td>' + (k + 1) + '</td><td>' + x.index + '</td><td><code>' + esc(x.text) + '</code></td><td>' + (g.join('<br>') || '—') + '</td></tr>';
    }).join('') : '';
    try { ro.textContent = rep.value ? t.replace(new RegExp(p, f), rep.value) : ''; } catch (e) { ro.textContent = ''; }
    $(r, '#re-repwrap').hidden = !rep.value;
  }
  var d = debounce(run, 150);
  [pat, fl, txt, rep].forEach(function (el) { on(el, 'input', d); });
  run();
};

function errCtx(text, line, col) {
  var lines = text.split(/\r\n|\r|\n/), L = line - 1, html = '';
  for (var k = Math.max(0, L - 2); k <= Math.min(lines.length - 1, L + 1); k++) {
    var num = String(k + 1).padStart(4, ' ') + ' | ', ln = lines[k].replace(/\t/g, '→');
    if (k === L) {
      var c = col - 1;
      html += '<span class="eline">' + esc(num) + esc(ln.slice(0, c)) + '<mark class="e">' + (esc(ln.charAt(c)) || '&nbsp;') + '</mark>' + esc(ln.slice(c + 1)) + '</span>\n';
      html += esc(' '.repeat(num.length + c)) + '^\n';
    } else html += esc(num + ln) + '\n';
  }
  return html;
}
function selectPos(ta, text, line, col) {
  var lines = text.split('\n'), p = 0;
  for (var k = 0; k < line - 1 && k < lines.length; k++) p += lines[k].length + 1;
  p += col - 1; ta.focus(); ta.setSelectionRange(p, Math.min(p + 1, text.length));
}

UI.yaml = function (r) {
  var inp = $(r, '#yaml-in'), out = $(r, '#yaml-out'), m = $(r, '#yaml-msg'), ctx = $(r, '#yaml-ctx'), wl = $(r, '#yaml-warn');
  function ind() { return +$(r, '#yaml-indent').value; }
  function showErr(kind, text, res, focus) {
    msg(m, 'bad', '✗ Invalid ' + kind + ' at <b>line ' + res.line + ', column ' + res.col + '</b>: ' + esc(res.message));
    ctx.innerHTML = errCtx(text, res.line, res.col); ctx.hidden = false;
    if (focus) selectPos(inp, text, res.line, res.col);
  }
  function warnings(ws) {
    wl.innerHTML = ws.slice(0, 30).map(function (w) { return '<li><b>Line ' + w.line + ':</b> ' + esc(w.message) + '</li>'; }).join('');
    wl.hidden = !ws.length;
  }
  function run(action) {
    var text = inp.value;
    ctx.hidden = true; warnings([]);
    if (!text.trim()) { msg(m, '', ''); if (action) out.value = ''; return; }
    if (action === 'toyaml') {
      var j = T.jsonCheck(text);
      if (!j.ok) { out.value = ''; showErr('JSON', text, j, true); return; }
      out.value = T.yamlStringify(j.value, ind());
      msg(m, 'ok', '✓ Valid JSON, converted to YAML');
      return;
    }
    var res = T.yamlCheck(text);
    if (!res.ok) { if (action) out.value = ''; showErr('YAML', text, res, !!action); return; }
    var n = res.docs.length;
    msg(m, 'ok', '✓ Valid YAML' + (n > 1 ? ' (' + n + ' documents)' : n === 0 ? ' (empty document)' : '') + (res.warnings.length ? ' · ' + res.warnings.length + ' warning' + (res.warnings.length > 1 ? 's' : '') + ' below' : ''));
    warnings(res.warnings);
    if (action === 'tojson') {
      var v = n === 1 ? res.docs[0] : res.docs;
      out.value = JSON.stringify(v, null, ind()) || 'null';
    }
  }
  on($(r, '#yaml-tojson'), 'click', function () { run('tojson'); });
  on($(r, '#yaml-toyaml'), 'click', function () { run('toyaml'); });
  on($(r, '#yaml-clear'), 'click', function () { inp.value = ''; out.value = ''; run(); });
  on($(r, '#yaml-swap'), 'click', function () { var t = inp.value; inp.value = out.value; out.value = t; run(); });
  on($(r, '#yaml-sample'), 'click', function () {
    inp.value = 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n    environment:\n      APP_ENV: production\n      DEBUG: no\n\tvolumes:\n      - ./html:/usr/share/nginx/html:ro\n';
    run('tojson');
  });
  copyBtn($(r, '#yaml-copy'), function () { return out.value; });
  on(inp, 'input', debounce(function () { run(); }, 250));
};

UI.uuid = function (r) {
  var out = $(r, '#uuid-out'), n = $(r, '#uuid-n'), m = $(r, '#uuid-msg'), inp = $(r, '#uuid-in'), info = $(r, '#uuid-info'), im = $(r, '#uuid-imsg');
  var gen7 = T.uuidV7Gen();
  function fmt(u) {
    if ($(r, '#uuid-nohy').checked) u = u.replace(/-/g, '');
    if ($(r, '#uuid-upper').checked) u = u.toUpperCase();
    if ($(r, '#uuid-braces').checked) u = '{' + u + '}';
    return u;
  }
  function gen() {
    var k = Math.floor(+n.value);
    if (!(k >= 1 && k <= 1000)) { msg(m, 'bad', 'Enter a count from 1 to 1000.'); return; }
    if (!window.crypto || !crypto.getRandomValues) { msg(m, 'bad', 'Your browser has no crypto.getRandomValues; cannot generate secure UUIDs.'); return; }
    var v = $(r, '#uuid-ver').value, list = [];
    for (var i = 0; i < k; i++) list.push(fmt(v === '7' ? gen7() : (crypto.randomUUID ? crypto.randomUUID() : T.uuidV4())));
    out.value = list.join('\n');
    msg(m, 'ok', 'Generated ' + k + ' UUID' + (k > 1 ? 's' : '') + ' (version ' + v + ')' + (v === '7' && k > 1 ? ', in strictly increasing order' : '') + '.');
  }
  function row(k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }
  function inspect() {
    var s = inp.value.trim();
    if (!s) { info.innerHTML = ''; msg(im, '', ''); return; }
    try {
      var x = T.uuidInspect(s), h = '';
      h += row('Canonical form', '<code>' + x.canonical + '</code>');
      if (x.special) { msg(im, 'ok', '✓ Valid: ' + esc(x.special)); info.innerHTML = h; return; }
      h += row('Version', x.standard ? x.version + ' — ' + esc(x.versionName) : 'n/a');
      h += row('Variant', esc(x.variant));
      if (x.ms !== undefined) {
        var d = new Date(x.ms);
        h += row('Timestamp', isNaN(d.getTime()) ? 'out of range' : '<code>' + esc(d.toISOString()) + '</code><br><small>' + esc(fmtLocal(d)) + ' · ' + esc(T.relTime(x.ms, Date.now())) + ' · Unix ms ' + Math.round(x.ms) + '</small>');
      }
      if (x.node) h += row('Node', '<code>' + x.node + '</code> ' + (x.multicast ? '<small>(multicast bit set: random node ID, not a real MAC address)</small>' : '<small>(usually the MAC address of the generating machine)</small>')) + row('Clock sequence', String(x.clockSeq));
      h += row('Hex (no hyphens)', '<code>' + x.hex + '</code>');
      info.innerHTML = h;
      msg(im, x.standard ? 'ok' : '', x.standard ? '✓ Valid RFC 9562 UUID' : 'Well-formed, but not an RFC 9562 variant UUID (the variant digit is ' + x.hex[16] + ', expected 8, 9, a or b).');
    } catch (e) { info.innerHTML = ''; msg(im, 'bad', '✗ ' + esc(e.message)); }
  }
  on($(r, '#uuid-gen'), 'click', gen);
  ['#uuid-ver', '#uuid-upper', '#uuid-nohy', '#uuid-braces'].forEach(function (s) { on($(r, s), 'change', gen); });
  copyBtn($(r, '#uuid-copy'), function () { return out.value; });
  on(inp, 'input', inspect);
  on($(r, '#uuid-use'), 'click', function () { inp.value = out.value.split('\n')[0]; inspect(); });
  gen();
};

UI.diff = function (r) {
  var a = $(r, '#diff-a'), b = $(r, '#diff-b'), m = $(r, '#diff-msg'), o = $(r, '#diff-out'), last = '';
  function cell(op, side, text, other) {
    if (text === undefined || text === null) return '<td class="ln"></td><td class="dx"></td>';
    var n = side === 'l' ? op.ai + 1 : op.bi + 1, body;
    if (other !== undefined && other !== null) {
      var d = T.inlineDiff(text, other);
      body = esc(text.slice(0, d.pre)) + '<mark>' + esc(text.slice(d.pre, text.length - d.suf)) + '</mark>' + esc(text.slice(text.length - d.suf));
    } else body = esc(text);
    return '<td class="ln">' + n + '</td><td class="dt">' + (body || '&nbsp;') + '</td>';
  }
  function run() {
    var ta = a.value, tb = b.value;
    if (!ta && !tb) { o.innerHTML = ''; msg(m, '', ''); last = ''; return; }
    var ops = T.diffLines(ta, tb, { ignoreWs: $(r, '#diff-ws').checked, ignoreCase: $(r, '#diff-case').checked });
    last = T.diffUnified(ops, 3, 'original', 'changed');
    if (!ops.added && !ops.removed) { msg(m, 'ok', '✓ No differences' + ($(r, '#diff-ws').checked || $(r, '#diff-case').checked ? ' (with the ignore options you chose)' : '') + ' · ' + ops.length + ' lines'); o.innerHTML = ''; return; }
    msg(m, '', '<b class="add">+' + ops.added + '</b> added, <b class="del">−' + ops.removed + '</b> removed, ' + ops.same + ' unchanged lines' + (ops.tooBig ? ' · <small>the texts are too different for a detailed diff, so changed blocks are shown as replaced</small>' : ''));
    var all = $(r, '#diff-all').checked, view = $(r, '#diff-view').value, html = '';
    if (view === 'unified') {
      var src = all ? T.diffUnified(ops, 1e9) : last;
      html = '<pre class="out udiff">' + src.split('\n').slice(2).map(function (l) {
        var c = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l[0] === '@' ? 'hunk' : '';
        return c ? '<span class="' + c + '">' + esc(l) + '</span>' : esc(l);
      }).join('\n') + '</pre>';
    } else {
      var rows = T.diffRows(ops), keep = [];
      rows.forEach(function (row, k) { if (row.t !== '=') for (var j = Math.max(0, k - 3); j <= Math.min(rows.length - 1, k + 3); j++) keep[j] = true; });
      html = '<div class="dwrap"><table class="diff"><colgroup><col class="cn"><col><col class="cn"><col></colgroup>';
      var skipped = 0;
      rows.forEach(function (row, k) {
        if (!all && !keep[k]) { skipped++; return; }
        if (skipped) { html += '<tr class="dskip"><td colspan="4">⋯ ' + skipped + ' unchanged line' + (skipped > 1 ? 's' : '') + '</td></tr>'; skipped = 0; }
        var l = row.l, rr = row.r;
        html += '<tr class="d' + (row.t === '=' ? 'eq' : row.t === '~' ? 'ch' : row.t === '-' ? 'del' : 'add') + '">' +
          cell(l, 'l', l && l.a, row.t === '~' ? rr.b : null) + cell(rr, 'r', rr && rr.b, row.t === '~' ? l.a : null) + '</tr>';
      });
      if (skipped) html += '<tr class="dskip"><td colspan="4">⋯ ' + skipped + ' unchanged line' + (skipped > 1 ? 's' : '') + '</td></tr>';
      html += '</table></div>';
    }
    o.innerHTML = html;
  }
  var d = debounce(run, 250);
  [a, b].forEach(function (el) { on(el, 'input', d); });
  ['#diff-ws', '#diff-case', '#diff-all', '#diff-view'].forEach(function (s) { on($(r, s), 'change', run); });
  on($(r, '#diff-swap'), 'click', function () { var t = a.value; a.value = b.value; b.value = t; run(); });
  on($(r, '#diff-sample'), 'click', function () {
    a.value = 'server {\n    listen 80;\n    server_name example.com;\n    root /var/www/html;\n\n    location / {\n        try_files $uri $uri/ =404;\n    }\n}\n';
    b.value = 'server {\n    listen 80;\n    server_name example.com www.example.com;\n    root /var/www/html;\n    client_max_body_size 20M;\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n    }\n}\n';
    run();
  });
  copyBtn($(r, '#diff-copy'), function () { return last; });
  run();
};

UI.http = function (r) {
  var q = $(r, '#http-q'), rows = r.querySelectorAll('tbody tr'), m = $(r, '#http-msg'), filt = '', btns = r.querySelectorAll('[data-f]');
  rows.forEach(function (tr) { tr._t = tr.textContent.toLowerCase(); });
  function run() {
    var s = q.value.trim().toLowerCase(), n = 0;
    rows.forEach(function (tr) {
      var okF = !filt || (filt === 'ns' ? tr.getAttribute('data-ns') === '1' : tr.getAttribute('data-c') === filt);
      var okQ = !s || (/^\d+x*$/.test(s) ? tr.id.slice(1).indexOf(s.replace(/x+$/, '')) === 0 : tr._t.indexOf(s) >= 0);
      tr.hidden = !(okF && okQ); if (!tr.hidden) n++;
    });
    btns.forEach(function (b) { b.className = b.getAttribute('data-f') === filt ? '' : 'sec'; });
    msg(m, n ? '' : 'bad', n ? n + ' status code' + (n > 1 ? 's' : '') : 'No status code matches "' + esc(q.value) + '"');
  }
  btns.forEach(function (b) { on(b, 'click', function () { filt = b.getAttribute('data-f'); run(); }); });
  on(q, 'input', run);
  var h = /^#s?(\d{3})$/.exec(location.hash);
  if (h) { q.value = h[1]; }
  run();
};

UI.hash = function (r) {
  var inp = $(r, '#hash-in'), file = $(r, '#hash-file'), exp = $(r, '#hash-exp'), m = $(r, '#hash-msg'), tb = $(r, '#hash-out'), src = $(r, '#hash-src');
  var current = null, fileInfo = null, seq = 0;
  function enc(bytes) {
    var f = $(r, '#hash-fmt').value;
    if (f === 'b64') return T.b64encodeBytes(bytes);
    var h = T.toHex(bytes); return f === 'HEX' ? h.toUpperCase() : h;
  }
  function render() {
    if (!current) { tb.innerHTML = ''; return; }
    var want = exp.value.trim() ? T.normalizeChecksum(exp.value).hex : '', match = null;
    tb.innerHTML = T.HASHES.map(function (alg) {
      var b = current[alg];
      if (!b) return '<tr><th>' + alg + '</th><td><small>Not available: crypto.subtle needs a secure (https) page</small></td></tr>';
      var hit = want && T.toHex(b) === want; if (hit) match = alg;
      return '<tr' + (hit ? ' class="hit"' : '') + '><th>' + alg + (hit ? ' ✓' : '') + '</th><td><code>' + esc(enc(b)) + '</code></td><td class="cp"><button class="sec" data-copy="' + alg + '">Copy</button></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-copy]').forEach(function (btn) { copyBtn(btn, function () { return enc(current[btn.getAttribute('data-copy')]); }); });
    if (!want) msg(m, '', '');
    else if (match) msg(m, 'ok', '✓ Match: the expected checksum equals the ' + match + ' hash.');
    else {
      var len = want.length, guess = { 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' }[len];
      msg(m, 'bad', '✗ No match. ' + (guess ? 'The expected value looks like ' + guess + ' (' + len + ' hex digits) but differs' + (fileInfo ? ': the file is corrupted, incomplete, or a different version.' : ': check for a trailing newline or different encoding of the text.') : 'The expected value has ' + len + ' characters, which is not a standard MD5/SHA length.'));
    }
  }
  function hashBytes(bytes, label) {
    var my = ++seq;
    src.textContent = label;
    T.hashAll(bytes).then(function (h) { if (my !== seq) return; current = h; render(); }, function (e) { msg(m, 'bad', esc(e.message || String(e))); });
  }
  function fromText() {
    fileInfo = null; file.value = '';
    var bytes = new TextEncoder().encode(inp.value);
    hashBytes(bytes, 'Hashing text: ' + bytes.length + ' bytes (UTF-8)');
  }
  on(inp, 'input', debounce(fromText, 150));
  on(file, 'change', function () {
    var f = file.files[0]; if (!f) return;
    fileInfo = f; src.textContent = 'Reading ' + f.name + '…';
    var rd = new FileReader();
    rd.onload = function () { hashBytes(new Uint8Array(rd.result), 'Hashing file: ' + f.name + ' (' + f.size.toLocaleString() + ' bytes) — read locally, not uploaded'); };
    rd.onerror = function () { msg(m, 'bad', 'Could not read the file.'); };
    rd.readAsArrayBuffer(f);
  });
  on($(r, '#hash-fmt'), 'change', render);
  on(exp, 'input', render);
  on($(r, '#hash-text'), 'click', fromText);
  fromText();
};

UI.whitespace = function (r) {
  var inp = $(r, '#ws-in'), file = $(r, '#ws-file'), m = $(r, '#ws-msg'), sum = $(r, '#ws-sum'), vis = $(r, '#ws-vis'), raw = null, fname = 'normalized.txt', enc = null;
  function text() { return raw !== null ? raw : inp.value; }
  function cnt(n, bad) { return n ? (bad ? '<b class="del">' + n + '</b>' : String(n)) : '0'; }
  function where(a) { return a.length ? ' <small>at line:col ' + a.slice(0, 8).join(', ') + (a.length > 8 ? '…' : '') + '</small>' : ''; }
  function row(k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }
  function run() {
    var t = text();
    if (!t) { sum.innerHTML = ''; vis.innerHTML = ''; msg(m, '', raw === null ? '' : ''); return; }
    var x = T.wsInspect(t), A = x.at, issues = [];
    if (x.eol === 'mixed') issues.push('mixed line endings');
    if (x.eol.indexOf('CRLF') === 0) issues.push('Windows (CRLF) line endings');
    if (x.cr) issues.push('lone CR line breaks');
    if (x.bom || (enc && enc.bom)) issues.push('a byte order mark');
    if (x.mixedIndent || (x.tabIndent && x.spaceIndent)) issues.push('mixed tab/space indentation');
    if (x.trailing) issues.push('trailing whitespace');
    if (x.nbsp) issues.push('non-breaking or unusual spaces');
    if (x.zeroWidth) issues.push('invisible zero-width characters');
    if (x.smart) issues.push('smart quotes or dashes');
    if (x.control) issues.push('control characters');
    var h = '';
    if (enc) h += row('File encoding', esc(enc.enc) + (enc.invalid ? ' <b class="del">(shown as Windows-1252)</b>' : ''));
    h += row('Line endings', '<b>' + esc(x.eol) + '</b> · CRLF ' + cnt(x.crlf) + ' · LF ' + cnt(x.lf) + ' · CR ' + cnt(x.cr, true) + (raw === null && !x.crlf && !x.cr ? '<br><small>Pasted text is always converted to LF by the browser: open the file to see its real line endings.</small>' : ''));
    h += row('Lines', x.lines + (x.finalNewline ? ' · ends with a newline' : ' · <b>no newline at end of file</b>'));
    h += row('Byte order mark', (x.bom || (enc && enc.bom)) ? '<b class="del">yes</b> <small>(U+FEFF at the start)</small>' : 'no');
    h += row('Indentation', 'tab-indented lines ' + cnt(x.tabIndent) + ' · space-indented lines ' + cnt(x.spaceIndent) + ' · tabs and spaces in the same indent ' + cnt(x.mixedIndent, true) + where(A.mixedIndent) + (x.tabIndent && x.spaceIndent ? '<br><small>Both tab- and space-indented lines found (tabs first at ' + A.tabIndent[0] + ', spaces first at ' + A.spaceIndent[0] + ').</small>' : ''));
    h += row('Trailing whitespace', cnt(x.trailing, true) + (x.trailing === 1 ? ' line' : ' lines') + where(A.trailing));
    h += row('Non-breaking / unusual spaces', cnt(x.nbsp, true) + where(A.nbsp));
    h += row('Zero-width characters', cnt(x.zeroWidth, true) + where(A.zeroWidth));
    h += row('Smart quotes / dashes', cnt(x.smart, true) + where(A.smart));
    h += row('Control characters', cnt(x.control, true) + where(A.control));
    sum.innerHTML = h;
    vis.innerHTML = T.wsVisualize(t, 1500);
    msg(m, issues.length ? 'bad' : 'ok', issues.length ? 'Found ' + listJoin(issues) + '.' : '✓ Clean: LF line endings, no BOM, consistent indentation, no trailing or invisible whitespace.');
  }
  on(inp, 'input', debounce(function () { raw = null; enc = null; run(); }, 200));
  on(file, 'change', function () {
    var f = file.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { enc = T.decodeFileBytes(new Uint8Array(rd.result)); raw = (enc.bom && enc.enc.indexOf('UTF-8') === 0 ? '\ufeff' : '') + enc.text; fname = f.name; inp.value = enc.text; run(); };
    rd.readAsArrayBuffer(f);
  });
  on($(r, '#ws-norm'), 'click', function () {
    var res = T.wsNormalize(text(), { eol: $(r, '#ws-eol').value, stripBom: $(r, '#ws-bom').checked, trailing: $(r, '#ws-trail').checked, tabs: +$(r, '#ws-tabs').value,
      nbsp: $(r, '#ws-nbsp').checked, zeroWidth: $(r, '#ws-zw').checked, smart: $(r, '#ws-smart').checked, finalNewline: $(r, '#ws-final').checked });
    raw = res; enc = enc ? { enc: 'UTF-8', text: res, bom: false } : null; inp.value = res; run();
  });
  copyBtn($(r, '#ws-copy'), function () { return text(); });
  on($(r, '#ws-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' })); a.download = fname; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  on($(r, '#ws-sample'), 'click', function () { raw = 'def main():\r\n    print("hi")   \r\n\tif True:\r\n        return\u00a01\r\n# smart \u201cquotes\u201d and a zero\u200bwidth space\r\n'; enc = null; fname = 'sample.py'; inp.value = raw; run(); });
  run();
};

UI.sql = function (r) {
  var inp = $(r, '#sql-in'), out = $(r, '#sql-out'), m = $(r, '#sql-msg'), last = 'fmt';
  function opts() { return { keywordCase: $(r, '#sql-case').value, indent: $(r, '#sql-indent').value }; }
  function run(action) {
    last = action || last;
    var t = inp.value;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      out.value = last === 'min' ? T.sqlMinify(t, opts()) : T.sqlFormat(t, opts());
      var toks = T.sqlTokenize(t), depth = 0, bad = '';
      toks.forEach(function (k) { if (k.t === 'open') depth++; else if (k.t === 'close') depth--; if (depth < 0 && !bad) bad = 'An extra ")" closes a parenthesis that was never opened.'; });
      if (!bad && depth > 0) bad = depth + ' unclosed "(" — a closing parenthesis is missing.';
      var last1 = toks.filter(function (k) { return k.t === 'str' || k.t === 'id'; }).pop();
      if (!bad && last1 && last1.v.length > 1 && last1.v.slice(-1) !== { "'": "'", '"': '"', '`': '`', '[': ']', N: "'", E: "'", X: "'", B: "'", n: "'", e: "'", x: "'", b: "'", $: '$' }[last1.v[0]]) bad = 'A quoted string or identifier is never closed: ' + esc(last1.v.slice(0, 30)) + '…';
      msg(m, bad ? 'bad' : 'ok', bad ? '⚠ Formatted, but check this: ' + bad : '✓ ' + (last === 'min' ? 'Minified' : 'Formatted') + ' ' + toks.filter(function (k) { return k.t === 'semi'; }).length + ' statement terminator(s), ' + out.value.split('\n').length + ' lines.');
    } catch (e) { msg(m, 'bad', esc(e.message)); }
  }
  on($(r, '#sql-fmt'), 'click', function () { run('fmt'); });
  on($(r, '#sql-min'), 'click', function () { run('min'); });
  on($(r, '#sql-case'), 'change', function () { run(); });
  on($(r, '#sql-indent'), 'change', function () { run(); });
  on(inp, 'input', debounce(function () { run(); }, 250));
  on($(r, '#sql-clear'), 'click', function () { inp.value = ''; run(); });
  on($(r, '#sql-sample'), 'click', function () {
    inp.value = "with recent as (select user_id, sum(total) as spent from orders where created_at >= now() - interval '30 days' and status in ('paid','shipped') group by user_id) select u.id, u.email, coalesce(r.spent, 0) as spent, case when r.spent > 1000 then 'vip' when r.spent > 0 then 'active' else 'idle' end as segment from users u left join recent r on r.user_id = u.id where u.deleted_at is null and u.id not in (select user_id from bans) order by spent desc limit 50;";
    run('fmt');
  });
  copyBtn($(r, '#sql-copy'), function () { return out.value; });
};

UI.curl = function (r) {
  var inp = $(r, '#curl-in'), out = $(r, '#curl-out'), m = $(r, '#curl-msg'), wl = $(r, '#curl-warn'), sum = $(r, '#curl-sum'), lang = 'python';
  var btns = r.querySelectorAll('[data-lang]');
  try { lang = localStorage.getItem('curlLang') || 'python'; } catch (e) { /* private mode */ }
  function run() {
    btns.forEach(function (b) { b.className = b.getAttribute('data-lang') === lang ? '' : 'sec'; });
    var t = inp.value; wl.hidden = true; sum.innerHTML = '';
    if (!t.trim()) { out.textContent = ''; msg(m, '', ''); return; }
    try {
      var p = T.curlParse(t);
      out.textContent = T.CURL_LANGS[lang](p);
      msg(m, 'ok', '✓ ' + esc(p.method) + ' ' + esc(p.url));
      wl.innerHTML = p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !p.warnings.length;
      var rows = [['Method', p.method], ['URL', p.url]];
      p.headers.forEach(function (h) { rows.push(['Header', h[0] + ': ' + h[1]]); });
      if (p.auth) rows.push(['Basic auth', p.auth[0] + ':' + (p.auth[1] ? '•'.repeat(Math.min(8, p.auth[1].length)) : '')]);
      if (p.body !== null) rows.push(['Body', (p.json !== undefined ? 'JSON · ' : '') + (p.body.length > 300 ? p.body.slice(0, 300) + '…' : p.body)]);
      p.form.forEach(function (f) { rows.push(['Form field', f.name + (f.file ? ' = file ' + f.file : ' = ' + f.value)]); });
      var fl = []; if (p.follow) fl.push('follow redirects (-L)'); if (p.insecure) fl.push('skip TLS verification (-k)'); if (p.compressed) fl.push('compressed'); if (p.timeout) fl.push('timeout ' + p.timeout + 's'); if (p.proxy) fl.push('proxy ' + p.proxy);
      if (fl.length) rows.push(['Options', fl.join(', ')]);
      sum.innerHTML = rows.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td><code>' + esc(x[1]) + '</code></td></tr>'; }).join('');
    } catch (e) { out.textContent = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  btns.forEach(function (b) { on(b, 'click', function () { lang = b.getAttribute('data-lang'); try { localStorage.setItem('curlLang', lang); } catch (e) { /* ignore */ } run(); }); });
  on(inp, 'input', debounce(run, 200));
  on($(r, '#curl-sample'), 'click', function () {
    inp.value = "curl -X POST 'https://api.example.com/v1/orders?notify=true' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  -b 'session=abc123' \\\n  --compressed -L \\\n  --data-raw '{\"item\":\"book\",\"qty\":2,\"gift\":false}'";
    run();
  });
  copyBtn($(r, '#curl-copy'), function () { return out.textContent; });
  run();
};

UI.gitignore = function (r) {
  var box = $(r, '#gi-boxes'), out = $(r, '#gi-out'), extra = $(r, '#gi-extra'), paths = $(r, '#gi-paths'), res = $(r, '#gi-res'), stat = $(r, '#gi-stat');
  var def = { Node: 1, macOS: 1, Windows: 1, VSCode: 1 };
  box.innerHTML = Object.keys(T.GITIGNORE).map(function (k) { return '<label><input type="checkbox" value="' + k + '"' + (def[k] ? ' checked' : '') + '> ' + esc(T.GITIGNORE[k].label) + '</label>'; }).join('');
  function gen() {
    var sel = [].slice.call(box.querySelectorAll('input:checked')).map(function (c) { return c.value; });
    out.value = sel.length || extra.value.trim() ? T.gitignoreCombine(sel, extra.value) : '';
    test();
  }
  function test() {
    var rules = T.gitignoreParse(out.value), n = rules.length;
    stat.textContent = n + ' pattern' + (n === 1 ? '' : 's');
    res.innerHTML = paths.value.split('\n').filter(function (p) { return p.trim(); }).slice(0, 200).map(function (p) {
      var x = T.gitignoreCheck(rules, p), why;
      if (x.ignored) why = x.via ? 'inside ignored directory <code>' + esc(x.via) + '</code> (line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>) — files in an excluded directory cannot be re-included with "!"' : 'line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>';
      else why = x.rule ? 're-included by line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>' : 'no pattern matches';
      return '<tr class="' + (x.ignored ? 'ign' : 'trk') + '"><th><code>' + esc(p.trim()) + '</code></th><td><b>' + (x.ignored ? 'Ignored' : 'Not ignored') + '</b> · ' + why + '</td></tr>';
    }).join('');
  }
  on(box, 'change', gen);
  on(extra, 'input', debounce(gen, 250));
  on(out, 'input', debounce(test, 200));
  on(paths, 'input', debounce(test, 200));
  copyBtn($(r, '#gi-copy'), function () { return out.value; });
  on($(r, '#gi-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/plain' })); a.download = '.gitignore'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  gen();
};

UI.csv = function (r) {
  var inp = $(r, '#csv-in'), out = $(r, '#csv-out'), m = $(r, '#csv-msg'), wl = $(r, '#csv-warn'), dir = 'c2j', dbtn = r.querySelectorAll('[data-dir]');
  function delim() { var d = $(r, '#csv-delim').value; return d === 'tab' ? '\t' : d; }
  function setDir(d) {
    dir = d;
    dbtn.forEach(function (b) { b.className = b.getAttribute('data-dir') === d ? '' : 'sec'; });
    $(r, '#csv-in-l').textContent = d === 'c2j' ? 'Paste CSV' : 'Paste JSON (an array of objects or arrays)';
    $(r, '#csv-infer-l').hidden = d !== 'c2j'; $(r, '#csv-crlf-l').hidden = d === 'c2j'; $(r, '#csv-flat-l').hidden = d === 'c2j';
    run();
  }
  function run() {
    var t = inp.value; wl.hidden = true;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      if (dir === 'c2j') {
        var res = T.csvToJson(t, { delimiter: delim(), header: $(r, '#csv-header').checked, infer: $(r, '#csv-infer').checked });
        out.value = JSON.stringify(res.data, null, 2);
        var dn = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[res.delimiter];
        msg(m, 'ok', '✓ ' + res.data.length + ' record' + (res.data.length === 1 ? '' : 's') + ' · delimiter: ' + dn + ($(r, '#csv-delim').value === 'auto' ? ' (detected)' : ''));
        wl.innerHTML = res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !res.warnings.length;
      } else {
        var chk = T.jsonCheck(t);
        if (!chk.ok) { out.value = ''; msg(m, 'bad', '✗ Invalid JSON at line ' + chk.line + ', column ' + chk.col + ': ' + esc(chk.message)); return; }
        out.value = T.jsonToCsv(chk.value, { delimiter: delim(), header: $(r, '#csv-header').checked, crlf: $(r, '#csv-crlf').checked, flatten: $(r, '#csv-flat').checked });
        var lines = T.csvParse(out.value, delim() === 'auto' ? ',' : delim()).rows.length;
        msg(m, 'ok', '✓ ' + lines + ' CSV row' + (lines === 1 ? '' : 's') + ' (including header)');
      }
    } catch (e) { out.value = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  dbtn.forEach(function (b) { on(b, 'click', function () { setDir(b.getAttribute('data-dir')); }); });
  ['#csv-delim', '#csv-header', '#csv-infer', '#csv-crlf', '#csv-flat'].forEach(function (s) { on($(r, s), 'change', run); });
  on(inp, 'input', debounce(run, 250));
  on($(r, '#csv-file'), 'change', function () {
    var f = $(r, '#csv-file').files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { var d = T.decodeFileBytes(new Uint8Array(rd.result)); inp.value = d.text; setDir(/\.json$/i.test(f.name) || /^\s*[\[{]/.test(d.text) ? 'j2c' : 'c2j'); if (d.invalid) msg(m, 'bad', 'The file is not valid UTF-8 and was read as Windows-1252: check accented characters.'); };
    rd.readAsArrayBuffer(f);
  });
  on($(r, '#csv-sample'), 'click', function () {
    if (dir === 'c2j') inp.value = 'id;name;city;active;balance\n1;"Smith, Anna";"Paris";true;1250.50\n2;"O\'Brien ""Bob""";Rome;false;0\n3;"Lee\nMultiline";"New York";true;\n';
    else inp.value = '[\n  {"id": 1, "name": "Anna", "address": {"city": "Paris", "zip": "75001"}, "tags": ["admin", "beta"]},\n  {"id": 2, "name": "Bob, Jr.", "address": {"city": "Rome"}, "note": "says \\"hi\\""}\n]';
    run();
  });
  on($(r, '#csv-swap'), 'click', function () { if (!out.value) return; inp.value = out.value; setDir(dir === 'c2j' ? 'j2c' : 'c2j'); });
  copyBtn($(r, '#csv-copy'), function () { return out.value; });
  on($(r, '#csv-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: dir === 'c2j' ? 'application/json' : 'text/csv' })); a.download = dir === 'c2j' ? 'data.json' : 'data.csv'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  setDir('c2j');
};

UI.subnet = function (r) {
  var inp = $(r, '#net-in'), m = $(r, '#net-msg'), tb = $(r, '#net-out'), ip = $(r, '#net-ip'), cm = $(r, '#net-cmsg'), sp = $(r, '#net-split'), subs = $(r, '#net-subs'), sc = $(r, '#net-scount');
  var info = null, v6 = false;
  function row(k, v, c) { return '<tr><th>' + k + '</th><td><code>' + esc(v) + '</code>' + (c ? ' <small>' + c + '</small>' : '') + '</td></tr>'; }
  function fmtN(n) { return Number(n).toLocaleString('en-US'); }
  function run() {
    var t = inp.value.trim(); tb.innerHTML = ''; subs.innerHTML = ''; sc.textContent = ''; info = null;
    if (!t) { msg(m, '', ''); return; }
    try {
      v6 = t.indexOf(':') >= 0;
      if (v6) {
        var x = info = T.ip6Info(t);
        tb.innerHTML = row('Address', x.address) + row('Expanded', x.expanded) + row('Network', x.network) + row('First address', x.first) + row('Last address', x.last) +
          row('Addresses', x.prefix >= 64 && x.prefix < 128 ? x.totalPow : x.total, x.prefix < 128 ? '(' + x.totalPow + (x.prefix <= 64 ? '; a /64 is the standard size for one LAN' : '') + ')' : '') + row('Type', x.type) + row('Reverse DNS (PTR)', x.ptr);
        msg(m, 'ok', '✓ IPv6 ' + esc(x.network) + (x.hostBitsSet ? ' <small>(you entered a host address inside this network)</small>' : ''));
      } else {
        var c = info = T.cidrInfo(t);
        tb.innerHTML = row('Network address', c.network) + row('CIDR notation', c.cidr) + row('Netmask', c.netmask, '/' + c.prefix) + row('Wildcard (inverse) mask', c.wildcard, 'for Cisco ACLs, OSPF') +
          row('Broadcast address', c.broadcast || '—', c.prefix >= 31 ? '(no broadcast in a /' + c.prefix + ')' : '') + row('First usable host', c.first) + row('Last usable host', c.last) +
          row('Total addresses', fmtN(c.total)) + row('Usable hosts', fmtN(c.usable), c.prefix === 31 ? '(point-to-point link, RFC 3021)' : c.prefix < 31 ? '(minus network and broadcast)' : '') +
          row('Address type', c.type) + row('Class (legacy)', c.cls) + row('Netmask in binary', c.binMask) + row('Address in binary', c.binAddr) + row('Integer / hex', c.int + ' / ' + c.hex) +
          (c.ptr ? row('Reverse DNS zone', c.ptr) : '');
        msg(m, c.hostBitsSet ? '' : 'ok', c.hostBitsSet ? 'Note: ' + esc(c.address) + ' is a host inside the network <b>' + esc(c.cidr) + '</b>. Many tools (Docker, Terraform, AWS, Python strict mode) require the network address itself.' : '✓ ' + esc(c.cidr));
        var opts = '';
        for (var p = c.prefix + 1; p <= Math.min(32, c.prefix + 16); p++) opts += '<option value="' + p + '">/' + p + ' — ' + fmtN(Math.pow(2, p - c.prefix)) + ' subnets of ' + fmtN(Math.pow(2, 32 - p)) + '</option>';
        sp.innerHTML = opts || '<option>—</option>';
        if (opts) sp.value = String(Math.min(32, c.prefix + 2));
        split();
      }
    } catch (e) { msg(m, 'bad', '✗ ' + esc(e.message)); }
    check();
  }
  function split() {
    subs.innerHTML = ''; sc.textContent = '';
    if (!info || v6 || !/^\d+$/.test(sp.value)) return;
    var s = T.cidrSplit(info.cidr, +sp.value, 256);
    sc.textContent = fmtN(s.count) + ' subnets' + (s.count > 256 ? ' (first 256 shown)' : '');
    subs.innerHTML = '<tr><th>Subnet</th><td><b>Usable hosts</b> · <b>Broadcast</b></td></tr>' + s.subnets.map(function (x) { return '<tr><th><code>' + x.cidr + '</code></th><td><code>' + x.first + ' – ' + x.last + '</code> · <code>' + (x.broadcast || '—') + '</code></td></tr>'; }).join('');
  }
  function check() {
    var q = ip.value.trim();
    if (!q || !info) { msg(cm, '', ''); return; }
    try {
      if (v6) {
        var a = T.ip6Info(q), inside = a.n >= T.ip6Parse(info.first).n && a.n <= T.ip6Parse(info.last).n;
        msg(cm, inside ? 'ok' : 'bad', (inside ? '✓ ' : '✗ ') + esc(a.address) + (inside ? ' is inside ' : ' is not in ') + esc(info.network));
      } else if (q.indexOf('/') >= 0 || /\s/.test(q)) {
        var o = T.cidrInfo(q), ov = T.cidrOverlap(info.cidr, o.cidr);
        msg(cm, ov ? 'bad' : 'ok', ov ? '⚠ ' + esc(o.cidr) + ' <b>overlaps</b> ' + esc(info.cidr) + ' (' + o.network + '–' + T.ip4Str(o.bcInt) + ' vs ' + info.network + '–' + T.ip4Str(info.bcInt) + '). Overlapping ranges cause routing conflicts, e.g. a VPN or Docker network hiding your LAN.' : '✓ ' + esc(o.cidr) + ' does not overlap ' + esc(info.cidr) + '.');
      } else {
        var yes = T.cidrContains(info.cidr, q);
        msg(cm, yes ? 'ok' : 'bad', (yes ? '✓ ' : '✗ ') + esc(q) + (yes ? ' is inside ' : ' is not in ') + esc(info.cidr) + (yes && T.ip4Parse(q) === info.netInt && info.prefix < 31 ? ' (it is the network address, not a usable host)' : yes && T.ip4Parse(q) === info.bcInt && info.prefix < 31 ? ' (it is the broadcast address, not a usable host)' : ''));
      }
    } catch (e) { msg(cm, 'bad', '✗ ' + esc(e.message)); }
  }
  on(inp, 'input', debounce(run, 200));
  on(ip, 'input', debounce(check, 200));
  on(sp, 'change', split);
  r.querySelectorAll('[data-net]').forEach(function (b) { on(b, 'click', function () { inp.value = b.getAttribute('data-net'); run(); }); });
  run();
};

UI.dockerrun = function (r) {
  var inp = $(r, '#dr-in'), out = $(r, '#dr-out'), m = $(r, '#dr-msg'), wl = $(r, '#dr-warn');
  function run() {
    var t = inp.value; wl.hidden = true;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      var res = T.dockerRunToCompose(t);
      out.value = res.yaml;
      msg(m, 'ok', '✓ ' + res.count + ' service' + (res.count > 1 ? 's' : '') + '. Save as <code>compose.yaml</code> and run <code>docker compose up -d</code>.');
      wl.innerHTML = res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !res.warnings.length;
    } catch (e) { out.value = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  on($(r, '#dr-conv'), 'click', run);
  on(inp, 'input', debounce(run, 250));
  on($(r, '#dr-sample'), 'click', function () {
    inp.value = 'docker run -d \\\n  --name web \\\n  -p 8080:80 \\\n  -v "$(pwd)/html:/usr/share/nginx/html:ro" \\\n  -e TZ=Europe/Berlin \\\n  --restart unless-stopped \\\n  nginx:alpine';
    run();
  });
  on($(r, '#dr-sample2'), 'click', function () {
    inp.value = "docker run -d --name db --network appnet -e POSTGRES_PASSWORD='s3cr$t' -v pgdata:/var/lib/postgresql/data --health-cmd 'pg_isready -U postgres' --health-interval 10s postgres:16\n" +
      'docker run -d --name api --network appnet -p 3000:3000 -e DATABASE_URL=postgres://postgres@db:5432/postgres --env-file .env -w /app -u 1000:1000 --restart on-failure myorg/api:1.4 node server.js';
    run();
  });
  copyBtn($(r, '#dr-copy'), function () { return out.value; });
  on($(r, '#dr-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/yaml' })); a.download = 'compose.yaml'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
};

UI.sql = function (r) {
  var inp = $(r, '#sql-in'), out = $(r, '#sql-out'), m = $(r, '#sql-msg'), last = 'fmt';
  function opts() { return { keywordCase: $(r, '#sql-case').value, indent: $(r, '#sql-indent').value }; }
  function run(action) {
    last = action || last;
    var t = inp.value;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      out.value = last === 'min' ? T.sqlMinify(t, opts()) : T.sqlFormat(t, opts());
      var toks = T.sqlTokenize(t), depth = 0, bad = '';
      toks.forEach(function (k) { if (k.t === 'open') depth++; else if (k.t === 'close') depth--; if (depth < 0 && !bad) bad = 'An extra ")" closes a parenthesis that was never opened.'; });
      if (!bad && depth > 0) bad = depth + ' unclosed "(" — a closing parenthesis is missing.';
      var last1 = toks.filter(function (k) { return k.t === 'str' || k.t === 'id'; }).pop();
      if (!bad && last1 && last1.v.length > 1 && last1.v.slice(-1) !== { "'": "'", '"': '"', '`': '`', '[': ']', N: "'", E: "'", X: "'", B: "'", n: "'", e: "'", x: "'", b: "'", $: '$' }[last1.v[0]]) bad = 'A quoted string or identifier is never closed: ' + esc(last1.v.slice(0, 30)) + '…';
      msg(m, bad ? 'bad' : 'ok', bad ? '⚠ Formatted, but check this: ' + bad : '✓ ' + (last === 'min' ? 'Minified' : 'Formatted') + ' ' + toks.filter(function (k) { return k.t === 'semi'; }).length + ' statement terminator(s), ' + out.value.split('\n').length + ' lines.');
    } catch (e) { msg(m, 'bad', esc(e.message)); }
  }
  on($(r, '#sql-fmt'), 'click', function () { run('fmt'); });
  on($(r, '#sql-min'), 'click', function () { run('min'); });
  on($(r, '#sql-case'), 'change', function () { run(); });
  on($(r, '#sql-indent'), 'change', function () { run(); });
  on(inp, 'input', debounce(function () { run(); }, 250));
  on($(r, '#sql-clear'), 'click', function () { inp.value = ''; run(); });
  on($(r, '#sql-sample'), 'click', function () {
    inp.value = "with recent as (select user_id, sum(total) as spent from orders where created_at >= now() - interval '30 days' and status in ('paid','shipped') group by user_id) select u.id, u.email, coalesce(r.spent, 0) as spent, case when r.spent > 1000 then 'vip' when r.spent > 0 then 'active' else 'idle' end as segment from users u left join recent r on r.user_id = u.id where u.deleted_at is null and u.id not in (select user_id from bans) order by spent desc limit 50;";
    run('fmt');
  });
  copyBtn($(r, '#sql-copy'), function () { return out.value; });
};

UI.curl = function (r) {
  var inp = $(r, '#curl-in'), out = $(r, '#curl-out'), m = $(r, '#curl-msg'), wl = $(r, '#curl-warn'), sum = $(r, '#curl-sum'), lang = 'python';
  var btns = r.querySelectorAll('[data-lang]');
  try { lang = localStorage.getItem('curlLang') || 'python'; } catch (e) { /* private mode */ }
  function run() {
    btns.forEach(function (b) { b.className = b.getAttribute('data-lang') === lang ? '' : 'sec'; });
    var t = inp.value; wl.hidden = true; sum.innerHTML = '';
    if (!t.trim()) { out.textContent = ''; msg(m, '', ''); return; }
    try {
      var p = T.curlParse(t);
      out.textContent = T.CURL_LANGS[lang](p);
      msg(m, 'ok', '✓ ' + esc(p.method) + ' ' + esc(p.url));
      wl.innerHTML = p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !p.warnings.length;
      var rows = [['Method', p.method], ['URL', p.url]];
      p.headers.forEach(function (h) { rows.push(['Header', h[0] + ': ' + h[1]]); });
      if (p.auth) rows.push(['Basic auth', p.auth[0] + ':' + (p.auth[1] ? '•'.repeat(Math.min(8, p.auth[1].length)) : '')]);
      if (p.body !== null) rows.push(['Body', (p.json !== undefined ? 'JSON · ' : '') + (p.body.length > 300 ? p.body.slice(0, 300) + '…' : p.body)]);
      p.form.forEach(function (f) { rows.push(['Form field', f.name + (f.file ? ' = file ' + f.file : ' = ' + f.value)]); });
      var fl = []; if (p.follow) fl.push('follow redirects (-L)'); if (p.insecure) fl.push('skip TLS verification (-k)'); if (p.compressed) fl.push('compressed'); if (p.timeout) fl.push('timeout ' + p.timeout + 's'); if (p.proxy) fl.push('proxy ' + p.proxy);
      if (fl.length) rows.push(['Options', fl.join(', ')]);
      sum.innerHTML = rows.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td><code>' + esc(x[1]) + '</code></td></tr>'; }).join('');
    } catch (e) { out.textContent = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  btns.forEach(function (b) { on(b, 'click', function () { lang = b.getAttribute('data-lang'); try { localStorage.setItem('curlLang', lang); } catch (e) { /* ignore */ } run(); }); });
  on(inp, 'input', debounce(run, 200));
  on($(r, '#curl-sample'), 'click', function () {
    inp.value = "curl -X POST 'https://api.example.com/v1/orders?notify=true' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  -b 'session=abc123' \\\n  --compressed -L \\\n  --data-raw '{\"item\":\"book\",\"qty\":2,\"gift\":false}'";
    run();
  });
  copyBtn($(r, '#curl-copy'), function () { return out.textContent; });
  run();
};

UI.gitignore = function (r) {
  var box = $(r, '#gi-boxes'), out = $(r, '#gi-out'), extra = $(r, '#gi-extra'), paths = $(r, '#gi-paths'), res = $(r, '#gi-res'), stat = $(r, '#gi-stat');
  var def = { Node: 1, macOS: 1, Windows: 1, VSCode: 1 };
  box.innerHTML = Object.keys(T.GITIGNORE).map(function (k) { return '<label><input type="checkbox" value="' + k + '"' + (def[k] ? ' checked' : '') + '> ' + esc(T.GITIGNORE[k].label) + '</label>'; }).join('');
  function gen() {
    var sel = [].slice.call(box.querySelectorAll('input:checked')).map(function (c) { return c.value; });
    out.value = sel.length || extra.value.trim() ? T.gitignoreCombine(sel, extra.value) : '';
    test();
  }
  function test() {
    var rules = T.gitignoreParse(out.value), n = rules.length;
    stat.textContent = n + ' pattern' + (n === 1 ? '' : 's');
    res.innerHTML = paths.value.split('\n').filter(function (p) { return p.trim(); }).slice(0, 200).map(function (p) {
      var x = T.gitignoreCheck(rules, p), why;
      if (x.ignored) why = x.via ? 'inside ignored directory <code>' + esc(x.via) + '</code> (line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>) — files in an excluded directory cannot be re-included with "!"' : 'line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>';
      else why = x.rule ? 're-included by line ' + x.rule.line + ': <code>' + esc(x.rule.text) + '</code>' : 'no pattern matches';
      return '<tr class="' + (x.ignored ? 'ign' : 'trk') + '"><th><code>' + esc(p.trim()) + '</code></th><td><b>' + (x.ignored ? 'Ignored' : 'Not ignored') + '</b> · ' + why + '</td></tr>';
    }).join('');
  }
  on(box, 'change', gen);
  on(extra, 'input', debounce(gen, 250));
  on(out, 'input', debounce(test, 200));
  on(paths, 'input', debounce(test, 200));
  copyBtn($(r, '#gi-copy'), function () { return out.value; });
  on($(r, '#gi-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/plain' })); a.download = '.gitignore'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  gen();
};

UI.csv = function (r) {
  var inp = $(r, '#csv-in'), out = $(r, '#csv-out'), m = $(r, '#csv-msg'), wl = $(r, '#csv-warn'), dir = 'c2j', dbtn = r.querySelectorAll('[data-dir]');
  function delim() { var d = $(r, '#csv-delim').value; return d === 'tab' ? '\t' : d; }
  function setDir(d) {
    dir = d;
    dbtn.forEach(function (b) { b.className = b.getAttribute('data-dir') === d ? '' : 'sec'; });
    $(r, '#csv-in-l').textContent = d === 'c2j' ? 'Paste CSV' : 'Paste JSON (an array of objects or arrays)';
    $(r, '#csv-infer-l').hidden = d !== 'c2j'; $(r, '#csv-crlf-l').hidden = d === 'c2j'; $(r, '#csv-flat-l').hidden = d === 'c2j';
    run();
  }
  function run() {
    var t = inp.value; wl.hidden = true;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      if (dir === 'c2j') {
        var res = T.csvToJson(t, { delimiter: delim(), header: $(r, '#csv-header').checked, infer: $(r, '#csv-infer').checked });
        out.value = JSON.stringify(res.data, null, 2);
        var dn = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[res.delimiter];
        msg(m, 'ok', '✓ ' + res.data.length + ' record' + (res.data.length === 1 ? '' : 's') + ' · delimiter: ' + dn + ($(r, '#csv-delim').value === 'auto' ? ' (detected)' : ''));
        wl.innerHTML = res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !res.warnings.length;
      } else {
        var chk = T.jsonCheck(t);
        if (!chk.ok) { out.value = ''; msg(m, 'bad', '✗ Invalid JSON at line ' + chk.line + ', column ' + chk.col + ': ' + esc(chk.message)); return; }
        out.value = T.jsonToCsv(chk.value, { delimiter: delim(), header: $(r, '#csv-header').checked, crlf: $(r, '#csv-crlf').checked, flatten: $(r, '#csv-flat').checked });
        var lines = T.csvParse(out.value, delim() === 'auto' ? ',' : delim()).rows.length;
        msg(m, 'ok', '✓ ' + lines + ' CSV row' + (lines === 1 ? '' : 's') + ' (including header)');
      }
    } catch (e) { out.value = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  dbtn.forEach(function (b) { on(b, 'click', function () { setDir(b.getAttribute('data-dir')); }); });
  ['#csv-delim', '#csv-header', '#csv-infer', '#csv-crlf', '#csv-flat'].forEach(function (s) { on($(r, s), 'change', run); });
  on(inp, 'input', debounce(run, 250));
  on($(r, '#csv-file'), 'change', function () {
    var f = $(r, '#csv-file').files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { var d = T.decodeFileBytes(new Uint8Array(rd.result)); inp.value = d.text; setDir(/\.json$/i.test(f.name) || /^\s*[\[{]/.test(d.text) ? 'j2c' : 'c2j'); if (d.invalid) msg(m, 'bad', 'The file is not valid UTF-8 and was read as Windows-1252: check accented characters.'); };
    rd.readAsArrayBuffer(f);
  });
  on($(r, '#csv-sample'), 'click', function () {
    if (dir === 'c2j') inp.value = 'id;name;city;active;balance\n1;"Smith, Anna";"Paris";true;1250.50\n2;"O\'Brien ""Bob""";Rome;false;0\n3;"Lee\nMultiline";"New York";true;\n';
    else inp.value = '[\n  {"id": 1, "name": "Anna", "address": {"city": "Paris", "zip": "75001"}, "tags": ["admin", "beta"]},\n  {"id": 2, "name": "Bob, Jr.", "address": {"city": "Rome"}, "note": "says \\"hi\\""}\n]';
    run();
  });
  on($(r, '#csv-swap'), 'click', function () { if (!out.value) return; inp.value = out.value; setDir(dir === 'c2j' ? 'j2c' : 'c2j'); });
  copyBtn($(r, '#csv-copy'), function () { return out.value; });
  on($(r, '#csv-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: dir === 'c2j' ? 'application/json' : 'text/csv' })); a.download = dir === 'c2j' ? 'data.json' : 'data.csv'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  setDir('c2j');
};

UI.subnet = function (r) {
  var inp = $(r, '#net-in'), m = $(r, '#net-msg'), tb = $(r, '#net-out'), ip = $(r, '#net-ip'), cm = $(r, '#net-cmsg'), sp = $(r, '#net-split'), subs = $(r, '#net-subs'), sc = $(r, '#net-scount');
  var info = null, v6 = false;
  function row(k, v, c) { return '<tr><th>' + k + '</th><td><code>' + esc(v) + '</code>' + (c ? ' <small>' + c + '</small>' : '') + '</td></tr>'; }
  function fmtN(n) { return Number(n).toLocaleString('en-US'); }
  function run() {
    var t = inp.value.trim(); tb.innerHTML = ''; subs.innerHTML = ''; sc.textContent = ''; info = null;
    if (!t) { msg(m, '', ''); return; }
    try {
      v6 = t.indexOf(':') >= 0;
      if (v6) {
        var x = info = T.ip6Info(t);
        tb.innerHTML = row('Address', x.address) + row('Expanded', x.expanded) + row('Network', x.network) + row('First address', x.first) + row('Last address', x.last) +
          row('Addresses', BigInt(x.total).toLocaleString('en-US'), x.prefix < 128 ? '(' + x.totalPow + (x.prefix === 64 ? '; a /64 is the standard size for one LAN' : '') + ')' : '') + row('Type', x.type) + row('Reverse DNS (PTR)', x.ptr);
        msg(m, 'ok', '✓ IPv6 ' + esc(x.network) + (x.hostBitsSet ? ' <small>(you entered a host address inside this network)</small>' : ''));
      } else {
        var c = info = T.cidrInfo(t);
        tb.innerHTML = row('Network address', c.network) + row('CIDR notation', c.cidr) + row('Netmask', c.netmask, '/' + c.prefix) + row('Wildcard (inverse) mask', c.wildcard, 'for Cisco ACLs, OSPF') +
          row('Broadcast address', c.broadcast || '—', c.prefix >= 31 ? '(no broadcast in a /' + c.prefix + ')' : '') + row('First usable host', c.first) + row('Last usable host', c.last) +
          row('Total addresses', fmtN(c.total)) + row('Usable hosts', fmtN(c.usable), c.prefix === 31 ? '(point-to-point link, RFC 3021)' : c.prefix < 31 ? '(minus network and broadcast)' : '') +
          row('Address type', c.type) + row('Class (legacy)', c.cls) + row('Netmask in binary', c.binMask) + row('Address in binary', c.binAddr) + row('Integer / hex', c.int + ' / ' + c.hex) +
          (c.ptr ? row('Reverse DNS zone', c.ptr) : '');
        msg(m, c.hostBitsSet ? '' : 'ok', c.hostBitsSet ? 'Note: ' + esc(c.address) + ' is a host inside the network <b>' + esc(c.cidr) + '</b>. Many tools (Docker, Terraform, AWS, Python strict mode) require the network address itself.' : '✓ ' + esc(c.cidr));
        var opts = '';
        for (var p = c.prefix + 1; p <= Math.min(32, c.prefix + 16); p++) opts += '<option value="' + p + '">/' + p + ' — ' + fmtN(Math.pow(2, p - c.prefix)) + ' subnets of ' + fmtN(Math.pow(2, 32 - p)) + '</option>';
        sp.innerHTML = opts || '<option>—</option>';
        if (opts) sp.value = String(Math.min(32, c.prefix + 2));
        split();
      }
    } catch (e) { msg(m, 'bad', '✗ ' + esc(e.message)); }
    check();
  }
  function split() {
    subs.innerHTML = ''; sc.textContent = '';
    if (!info || v6 || !/^\d+$/.test(sp.value)) return;
    var s = T.cidrSplit(info.cidr, +sp.value, 256);
    sc.textContent = fmtN(s.count) + ' subnets' + (s.count > 256 ? ' (first 256 shown)' : '');
    subs.innerHTML = '<tr><th>Subnet</th><td><b>Usable hosts</b> · <b>Broadcast</b></td></tr>' + s.subnets.map(function (x) { return '<tr><th><code>' + x.cidr + '</code></th><td><code>' + x.first + ' – ' + x.last + '</code> · <code>' + (x.broadcast || '—') + '</code></td></tr>'; }).join('');
  }
  function check() {
    var q = ip.value.trim();
    if (!q || !info) { msg(cm, '', ''); return; }
    try {
      if (v6) {
        var a = T.ip6Info(q), inside = a.n >= T.ip6Parse(info.first).n && a.n <= T.ip6Parse(info.last).n;
        msg(cm, inside ? 'ok' : 'bad', (inside ? '✓ ' : '✗ ') + esc(a.address) + (inside ? ' is inside ' : ' is not in ') + esc(info.network));
      } else if (q.indexOf('/') >= 0 || /\s/.test(q)) {
        var o = T.cidrInfo(q), ov = T.cidrOverlap(info.cidr, o.cidr);
        msg(cm, ov ? 'bad' : 'ok', ov ? '⚠ ' + esc(o.cidr) + ' <b>overlaps</b> ' + esc(info.cidr) + ' (' + o.network + '–' + T.ip4Str(o.bcInt) + ' vs ' + info.network + '–' + T.ip4Str(info.bcInt) + '). Overlapping ranges cause routing conflicts, e.g. a VPN or Docker network hiding your LAN.' : '✓ ' + esc(o.cidr) + ' does not overlap ' + esc(info.cidr) + '.');
      } else {
        var yes = T.cidrContains(info.cidr, q);
        msg(cm, yes ? 'ok' : 'bad', (yes ? '✓ ' : '✗ ') + esc(q) + (yes ? ' is inside ' : ' is not in ') + esc(info.cidr) + (yes && T.ip4Parse(q) === info.netInt && info.prefix < 31 ? ' (it is the network address, not a usable host)' : yes && T.ip4Parse(q) === info.bcInt && info.prefix < 31 ? ' (it is the broadcast address, not a usable host)' : ''));
      }
    } catch (e) { msg(cm, 'bad', '✗ ' + esc(e.message)); }
  }
  on(inp, 'input', debounce(run, 200));
  on(ip, 'input', debounce(check, 200));
  on(sp, 'change', split);
  r.querySelectorAll('[data-net]').forEach(function (b) { on(b, 'click', function () { inp.value = b.getAttribute('data-net'); run(); }); });
  run();
};

UI.dockerrun = function (r) {
  var inp = $(r, '#dr-in'), out = $(r, '#dr-out'), m = $(r, '#dr-msg'), wl = $(r, '#dr-warn');
  function run() {
    var t = inp.value; wl.hidden = true;
    if (!t.trim()) { out.value = ''; msg(m, '', ''); return; }
    try {
      var res = T.dockerRunToCompose(t);
      out.value = res.yaml;
      msg(m, 'ok', '✓ ' + res.count + ' service' + (res.count > 1 ? 's' : '') + '. Save as <code>compose.yaml</code> and run <code>docker compose up -d</code>.');
      wl.innerHTML = res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join(''); wl.hidden = !res.warnings.length;
    } catch (e) { out.value = ''; msg(m, 'bad', '✗ ' + esc(e.message)); }
  }
  on($(r, '#dr-conv'), 'click', run);
  on(inp, 'input', debounce(run, 250));
  on($(r, '#dr-sample'), 'click', function () {
    inp.value = 'docker run -d \\\n  --name web \\\n  -p 8080:80 \\\n  -v "$(pwd)/html:/usr/share/nginx/html:ro" \\\n  -e TZ=Europe/Berlin \\\n  --restart unless-stopped \\\n  nginx:alpine';
    run();
  });
  on($(r, '#dr-sample2'), 'click', function () {
    inp.value = "docker run -d --name db --network appnet -e POSTGRES_PASSWORD='s3cr$t' -v pgdata:/var/lib/postgresql/data --health-cmd 'pg_isready -U postgres' --health-interval 10s postgres:16\n" +
      'docker run -d --name api --network appnet -p 3000:3000 -e DATABASE_URL=postgres://postgres@db:5432/postgres --env-file .env -w /app -u 1000:1000 --restart on-failure myorg/api:1.4 node server.js';
    run();
  });
  copyBtn($(r, '#dr-copy'), function () { return out.value; });
  on($(r, '#dr-dl'), 'click', function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/yaml' })); a.download = 'compose.yaml'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
};

document.querySelectorAll('[data-tool]').forEach(function (el) { var f = UI[el.getAttribute('data-tool')]; if (f) f(el); });
})();
