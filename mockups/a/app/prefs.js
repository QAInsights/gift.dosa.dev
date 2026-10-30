/* Gift Cabinet mockups · shared locale prefs · reads gc-prefs, formats amounts and dates. */
window.gcPrefs = (function () {
  var LOCALES = { US: 'en-US', UK: 'en-GB', IN: 'en-IN' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function get() {
    try { return Object.assign({ region: 'US', currency: 'USD', dateFmt: 'MDY' }, JSON.parse(localStorage.getItem('gc-prefs') || '{}')); }
    catch (e) { return { region: 'US', currency: 'USD', dateFmt: 'MDY' }; }
  }
  function money(amount, p) {
    var loc = LOCALES[(p || get()).region] || 'en-US';
    var cur = (p || get()).currency || 'USD';
    try { return new Intl.NumberFormat(loc, { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(amount)); }
    catch (e) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(Number(amount)); }
  }
  function date(iso, fmt) {
    var parts = String(iso).split('-');
    var m = MONTHS[Number(parts[1]) - 1] || parts[1], d = String(Number(parts[2]));
    var f = fmt || get().dateFmt;
    return f === 'DMY' ? d + ' ' + m : f === 'ISO' ? parts[0] + '-' + parts[1] + '-' + parts[2] : m + ' ' + d;
  }
  function apply(root) {
    var p = get();
    (root || document).querySelectorAll('[data-amount]').forEach(function (el) { el.textContent = money(el.getAttribute('data-amount'), p); });
    (root || document).querySelectorAll('[data-date]').forEach(function (el) { el.textContent = date(el.getAttribute('data-date'), p.dateFmt); });
  }
  document.addEventListener('DOMContentLoaded', function () { apply(document); });
  return { get: get, money: money, date: date, apply: apply };
})();
