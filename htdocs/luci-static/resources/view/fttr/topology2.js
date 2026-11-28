// SPDX-License-Identifier: Apache-2.0
// Enhanced FTTR topology view. Uses ubus fttr.get_topology directly and shows
// far more information than the bundle view, in a compact card layout.
'use strict';
'require dom';
'require rpc';
'require ui';
'require view';

var callTopology = rpc.declare({ object: 'fttr', method: 'get_topology' });

var CSS =
  '.fttr-top2{display:flex;flex-direction:column;gap:14px}' +
  '.fttr-top2 .t2-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
  '.fttr-top2 .t2-title{font-size:15px;font-weight:600}' +
  '.fttr-top2 .t2-meta{font-size:12px;color:var(--text-color-secondary,#888)}' +
  '.fttr-top2 .t2-btn{cursor:pointer}' +
  '.fttr-top2 .t2-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}' +
  '.fttr-top2 .t2-stat{border:1px solid var(--border-color,rgba(0,0,0,.15));border-radius:8px;padding:10px 12px;text-align:center;background:var(--background-color-primary,#fff)}' +
  '.fttr-top2 .t2-stat-n{font-size:22px;font-weight:600;line-height:1.2}' +
  '.fttr-top2 .t2-stat-l{font-size:11px;color:var(--text-color-secondary,#888);margin-top:3px}' +
  '.fttr-top2 .t2-stat.ok .t2-stat-n{color:#1e8449}.fttr-top2 .t2-stat.warn .t2-stat-n{color:#b9770e}.fttr-top2 .t2-stat.err .t2-stat-n{color:#c0392b}' +
  '.fttr-top2 .t2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}' +
  '.fttr-top2 .t2-card{border:1px solid var(--border-color,rgba(0,0,0,.15));border-left:4px solid #2874a6;border-radius:10px;padding:14px 16px;background:var(--background-color-primary,#fff)}' +
  '.fttr-top2 .t2-card.onu{border-left-color:#158353}.fttr-top2 .t2-card.off{border-left-color:#b9770e}' +
  '.fttr-top2 .t2-card-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}' +
  '.fttr-top2 .t2-badge{padding:1px 8px;border-radius:10px;font-size:11px;background:rgba(40,116,166,.14);color:#2874a6}' +
  '.fttr-top2 .t2-badge.onu{background:rgba(21,131,83,.14);color:#158353}' +
  '.fttr-top2 .t2-badge.off{background:rgba(185,119,14,.14);color:#b9770e}' +
  '.fttr-top2 .t2-name{font-weight:600;font-size:14px}' +
  '.fttr-top2 .t2-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.8;border-top:1px solid rgba(128,128,128,.1);padding:2px 0}' +
  '.fttr-top2 .t2-row:first-of-type{border-top:0}' +
  '.fttr-top2 .t2-k{color:var(--text-color-secondary,#888)}' +
  '.fttr-top2 .t2-v{font-weight:500;text-align:right}' +
  '.fttr-top2 .t2-sec{margin:10px 0 6px;font-size:11px;color:var(--text-color-secondary,#888);text-transform:uppercase;letter-spacing:.4px}' +
  '.fttr-top2 .t2-note{font-size:12px;color:var(--text-color-secondary,#888);line-height:1.6}' +
  '@media(prefers-color-scheme:dark){.fttr-top2 .t2-stat,.fttr-top2 .t2-card{background:rgba(255,255,255,.05)}}';

function num(v, unit, digits) {
  if (v == null || v === '' || !isFinite(Number(v)))
    return '-';
  return Number(v).toFixed(digits == null ? 2 : digits) + (unit || '');
}
function txt(v) { return v == null || v === '' ? '-' : String(v); }
function yesno(v) { return v == null ? '-' : (v ? _('Yes') : _('No')); }

function labelForState(s) {
  var map = {
    O1: 'O1 — ' + _('Initial'), O2_3: 'O2-3 — ' + _('Serial number'),
    O4: 'O4 — ' + _('Ranging'), O5: 'O5 — ' + _('Operation'),
    O7: 'O7 — ' + _('Emergency stop')
  };
  return map[s] || txt(s);
}

function stat(label, value, cls) {
  return E('div', { 'class': 't2-stat' + (cls ? ' ' + cls : '') }, [
    E('div', { 'class': 't2-stat-n' }, String(value)),
    E('div', { 'class': 't2-stat-l' }, label)
  ]);
}
function row(k, v) {
  return E('div', { 'class': 't2-row' }, [
    E('span', { 'class': 't2-k' }, k),
    E('span', { 'class': 't2-v' }, v == null || v === '' ? '-' : v)
  ]);
}
function section(t) { return E('div', { 'class': 't2-sec' }, t); }

function controllerCard(node) {
  var d = node.detail || {};
  var o = d.optical || {};
  var m = o.measurements || {};
  var body = [
    E('div', { 'class': 't2-card-h' }, [
      E('span', { 'class': 't2-badge' }, _('OLT')),
      E('span', { 'class': 't2-name' }, node.label || _('OLT controller'))
    ]),
    section(_('Optical module')),
    row(_('Module'), txt(o.model)),
    row(_('Wavelength TX/RX'), txt(o.wavelength_tx_nm) + ' / ' + txt(o.wavelength_rx_nm) + ' nm'),
    row(_('Nominal capacity'), num(o.nominal_downlink_gbps, ' Gbps', 1) + ' / ' + num(o.nominal_uplink_gbps, ' Gbps', 1)),
    row(_('TX power'), num(o.tx_power_dbm, ' dBm')),
    row(_('Laser bias'), num(o.laser_bias_current_ma, ' mA')),
    row(_('Temperature'), num(o.temperature_celsius, ' °C', 1)),
    row(_('Voltage'), num(o.vcc_voltage, ' V', 2)),
    row(_('TX enabled'), yesno(o.tx_enabled)),
    section(_('System')),
    row(_('Model'), txt(d.model)),
    row(_('Firmware'), txt(d.firmware_version)),
    row(_('FPGA status'), txt(d.fpga_status)),
    row(_('Uptime'), d.uptime_seconds != null ? num(d.uptime_seconds / 3600, ' h', 1) : '-')
  ];
  var uplinks = d.uplinks || [];
  if (uplinks.length) {
    body.push(section(_('Uplinks')));
    uplinks.forEach(function(u) {
      body.push(row(txt(u.interface) + (u.up ? ' \u25CF' : ' \u25CB'),
        (u.protocol || '') + ' ' + (u.addresses || []).join(', ')));
    });
  }
  return E('div', { 'class': 't2-card' }, body);
}

function onuCard(node) {
  var d = node.detail || {};
  var reg = d.registration || {};
  var meas = d.measurements || {};
  var business = d.business || {};
  var identity = d.identity || {};
  var online = reg.state === 'O5' || reg.state === 'o5_operation';

  var body = [
    E('div', { 'class': 't2-card-h' }, [
      E('span', { 'class': 't2-badge ' + (online ? 'onu' : 'off') }, _('ONU')),
      E('span', { 'class': 't2-name' }, node.label || txt(d.serial_number) || _('Downstream device'))
    ]),
    section(_('Registration')),
    row(_('ONU ID'), txt(d.onu_id)),
    row(_('State'), labelForState(reg.state)),
    row(_('PON mode'), txt(d.pon_mode)),
    row(_('Serial number'), txt(d.serial_number)),
    row(_('Vendor / model'), txt(d.vendor) + ' / ' + txt(d.model)),
    row(_('Firmware'), txt(d.firmware_version)),
    row(_('Uptime'), d.uptime_seconds != null ? num(d.uptime_seconds / 3600, ' h', 1) : '-'),
    section(_('Optical & link')),
    row(_('RX power'), num(meas.rx_power_dbm, ' dBm')),
    row(_('TX power'), num(meas.tx_power_dbm, ' dBm')),
    row(_('Upstream rate'), num(d.upstream_phy_rate_gbps, ' Gbps', 2)),
    row(_('FEC'), d.fec ? txt(d.fec.state || d.fec.mode) : '-'),
    section(_('Business')),
    row(_('Status'), txt(business.status)),
    row(_('Management'), d.management ? txt(d.management.status) : '-'),
    row(_('Provisioning'), d.provisioning ? txt(d.provisioning.status) : '-')
  ];
  if (identity && identity.loid)
    body.push(row(_('LOID'), txt(identity.loid)));
  return E('div', { 'class': 't2-card ' + (online ? 'onu' : 'off') }, body);
}

function renderView(data) {
  var reply = data || {};
  var nodes = reply.nodes || [];
  var links = reply.links || [];
  var issues = reply.issues || [];
  var controllers = nodes.filter(function(n) { return n.detail && n.detail.kind === 'controller'; });
  var onus = nodes.filter(function(n) { return n.detail && n.detail.kind === 'onu'; });
  var online = onus.filter(function(n) {
    var s = n.detail.registration && n.detail.registration.state;
    return s === 'O5' || s === 'o5_operation';
  }).length;

  var root = E('div', { 'class': 'fttr-top2' }, [
    E('style', {}, CSS),
    E('div', { 'class': 't2-head' }, [
      E('span', { 'class': 't2-title' }, _('FTTR topology')),
      E('span', { 'class': 't2-meta' },
        _('Snapshot') + ': ' + txt(reply.snapshot_id) + ' · ' +
        _('Updated') + ': ' + (reply.generated_at ? new Date(reply.generated_at * 1000).toLocaleTimeString() : '-')),
      E('button', {
        'class': 'cbi-button t2-btn', 'type': 'button',
        'click': ui.createHandlerFn(this, 'handleRefresh')
      }, _('Refresh'))
    ]),
    E('div', { 'class': 't2-stats' }, [
      stat(_('OLT'), controllers.length),
      stat(_('ONU'), onus.length),
      stat(_('Online'), online, online === onus.length && onus.length ? 'ok' : 'warn'),
      stat(_('Links'), links.length),
      stat(_('Issues'), issues.length, issues.length ? 'err' : 'ok')
    ])
  ]);

  if (!nodes.length)
    root.appendChild(E('p', { 'class': 't2-note' }, _('No topology data available. Is the FTTR daemon running?')));

  var grid = E('div', { 'class': 't2-grid' });
  controllers.forEach(function(n) { grid.appendChild(controllerCard(n)); });
  onus.forEach(function(n) { grid.appendChild(onuCard(n)); });
  root.appendChild(grid);

  if (issues.length) {
    var ib = E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Topology issues')) ]);
    issues.forEach(function(x) {
      ib.appendChild(E('p', { 'class': 't2-note' },
        txt(x.code || x.kind || x.id) + ': ' + txt(x.message || x.reason || '')));
    });
    root.appendChild(ib);
  }
  return root;
}

return view.extend({
  load: function() { return callTopology(); },
  render: function(data) {
    return E('div', { 'id': 'fttr-top2-root' }, renderView.call(this, data));
  },
  handleRefresh: function() {
    var self = this;
    return callTopology().then(function(data) {
      var root = document.getElementById('fttr-top2-root');
      if (root) dom.content(root, renderView.call(self, data));
    }).catch(function(e) {
      ui.addNotification(null, E('p', {}, _('Topology refresh failed: %s').format(e.message)));
    });
  }
});
