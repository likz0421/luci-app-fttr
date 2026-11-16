// SPDX-License-Identifier: Apache-2.0

import { pendingPorts, readPortConfiguration } from "../components/status-model";
import type { FttrStatus } from "../contracts/status";
import { choice, field } from "./form";

export function addPorts(section: LuCI.form.AbstractSection, status: FttrStatus | null): void {
	section.tab("ports", _("Downstream ports"));
	const ports = section.taboption(
		"ports",
		L.form.SectionValue,
		"_ports",
		L.form.NamedSection,
		"ports",
		"ports",
	).subsection;
	ports.addremove = false;
	ports.anonymous = false;
	const config = readPortConfiguration();
	const running = status?.switch_ports ? new Set(status.switch_ports.map((p) => p.interface)).size : null;
	const summary = field(ports, L.form.DummyValue, "_port_status", _("Port configuration"));
	summary.render = () =>
		Promise.resolve(
			<div class="fttr-port-settings cbi-section">
				<h3>{_("FTTR downstream")}</h3>
				<div class="fttr-settings-metrics">
					<span>
						{_("Configured")}
						<strong>{config.enabled ? config.count : 0}</strong>
					</span>
					<span>
						{_("Running")}
						<strong>{running ?? _("Not reported")}</strong>
					</span>
					<span class={`fttr-badge fttr-badge-${pendingPorts(config, running) ? "warning" : "info"}`}>
						{pendingPorts(config, running)
							? _("Pending device reboot")
							: running === null
								? _("Runtime unavailable")
								: _("Configuration matches runtime")}
					</span>
				</div>
				<p>
					{_(
						"Save, then reboot the device to apply. Restarting the FTTR service does not change the running interfaces.",
					)}
				</p>
				<p>
					{_(
						"Reducing the count disconnects higher-numbered interfaces after reboot. Disabling FTTR downstream disconnects all downstream devices after reboot. Running interfaces stay visible until the reboot.",
					)}
				</p>
				<p>
					{_(
						"Counts describe logical downstream interfaces, not physical splitter sockets. The status above reflects saved configuration; edits below are staged until saved.",
					)}
				</p>
			</div>,
		);
	const enabled = field(ports, L.form.Flag, "enabled", _("Enable FTTR downstream"));
	enabled.default = "1";
	enabled.rmempty = false;
	enabled.description = _("Save, then reboot the device to apply.");
	const count = choice(
		ports,
		"count",
		_("Downstream interface count"),
		Array.from({ length: 16 }, (_item, i): [string, string] => [
			String(i + 1),
			[1, 2, 4, 8, 16].includes(i + 1) ? `${i + 1} · ${_("Recommended")}` : String(i + 1),
		]),
	);
	count.default = "16";
	count.rmempty = false;
	count.retain = true;
	count.validate = (_id, value) =>
		typeof value === "string" && /^(?:[1-9]|1[0-6])$/.test(value) ? true : _("Choose 1–16 downstream interfaces.");
	count.description = _(
		"All counts from 1 to 16 are supported. New firmware defaults to 4; existing configurations without this section retain 16 for compatibility. Reducing the count affects higher-numbered connections after reboot.",
	);
}
