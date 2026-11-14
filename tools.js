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

document.querySelectorAll('[data-tool]').forEach(function (el) { var f = UI[el.getAttribute('data-tool')]; if (f) f(el); });
})();
