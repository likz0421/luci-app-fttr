// SPDX-License-Identifier: Apache-2.0
import type { PlatformInfoReply } from "../contracts/api";
import type { FttrStatus, SubGateway } from "../contracts/status";
import {
	getBusinessBadgeSpec,
	getCwmpBadgeSpec,
	getProvisioningBadgeSpec,
	getRegistrationBadgeSpec,
	getWifiSyncBadgeSpec,
	updateBadge,
} from "./badge";
import { formatFirmware, formatUptime } from "./formatters";
import { showOnuDetails } from "./onu-details";
import { confirmOnuPin } from "./onu-pin";
import { deviceState, identityText, visibleOnus } from "./status-model";

function power(value: number | null): string {
	return value === null || !Number.isFinite(value) ? _("Not reported") : `${value.toFixed(2)} dBm`;
}
function createCard(initial: SubGateway, platform: PlatformInfoReply, onSaved: (status: FttrStatus) => void) {
	let current = initial;
	let pinning: FttrStatus["onu_pinning"];
	const title = <h4>{_("Optical sub-gateway")}</h4>;
	const serial = <code />;
	const state = <span />;
	const vendor = <span />;
	const optical = <strong />;
	const transmit = <strong />;
	const dataInterface = <code />;
	const firmware = <span />;
	const age = <small />;
	const uptime = <span />;
	const registration = <span />;
	const business = <span />;
	const cwmp = <span />;
	const sync = <span />;
	const wifi = <span />;
	const pin = (
		<button
			type="button"
			class="cbi-button cbi-button-neutral"
			onclick={() => confirmOnuPin(current, pinning, platform, onSaved)}
		/>
	);
	const item = (label: string, node: HTMLElement) => (
		<div class="fttr-device-field">
			<dt>{label}</dt>
			<dd>{node}</dd>
		</div>
	);
	const element = (
		<section class="fttr-device-card" data-fttr-onu-id={String(initial.onu_id)}>
			<header>
				<span class="fttr-device-symbol" aria-hidden="true">
					<img src="/luci-static/resources/icons/port_up.svg" width={32} height={32} alt="" />
				</span>
				<div>
					{title}
					{serial}
				</div>
				{state}
			</header>
			<p class="fttr-device-vendor">{vendor}</p>
			<div class="fttr-optical-pair">
				<div>
					<small>{_("ONU Rx")}</small>
					{optical}
				</div>
				<span class="fttr-optical-link" aria-hidden="true" />
				<div>
					<small>{_("ONU Tx")}</small>
					{transmit}
				</div>
			</div>
			<dl class="fttr-device-fields">
				{item(_("Registration"), registration)}
				{item(_("Business"), business)}
				{item(_("CWMP"), cwmp)}
				{item(_("Synchronization"), sync)}
				{item(_("Wi-Fi sync"), wifi)}
				{item(_("Data interface"), dataInterface)}
			</dl>
			<details>
				<summary>{_("Identity and measurements")}</summary>
				<dl class="fttr-device-fields">
					{item(_("Firmware"), firmware)}
					{item(_("Uptime"), uptime)}
				</dl>
				{age}
			</details>
			<footer>
				{pin}
				<button type="button" class="cbi-button cbi-button-action" onclick={() => showOnuDetails(current)}>
					{_("Details")}
				</button>
			</footer>
		</section>
	);
	const update = (onu: SubGateway, nextPinning: FttrStatus["onu_pinning"]) => {
		current = onu;
		pinning = nextPinning;
		element.dataset.fttrOnuId = String(onu.onu_id);
		const online = deviceState(onu);
		element.dataset.state = online;
		title.textContent =
			identityText(onu.identity?.equipment_id) ??
			identityText(onu.model) ??
			`${_("Optical sub-gateway")} · ${onu.onu_id}`;
		serial.textContent = identityText(onu.serial_number) ?? _("Identity pending");
		vendor.textContent = `${identityText(onu.vendor) ?? _("Vendor not identified")} · ONU ${onu.onu_id}`;
		updateBadge(
			state,
			online === "online" ? "success" : online === "identifying" ? "info" : "neutral",
			online === "online" ? _("Online") : online === "identifying" ? _("Identifying") : _("Offline"),
		);
		for (const [node, spec] of [
			[registration, getRegistrationBadgeSpec(onu.state)],
			[business, getBusinessBadgeSpec(onu.business_status)],
			[cwmp, getCwmpBadgeSpec(onu.management)],
			[sync, getProvisioningBadgeSpec(onu.provisioning)],
			[wifi, getWifiSyncBadgeSpec(onu.wifi_sync)],
		] as const)
			updateBadge(node, spec.tone, spec.label, spec.title);
		optical.textContent = power(onu.optical_rx_power_dbm);
		transmit.textContent = power(onu.optical_tx_power_dbm);
		optical.title = onu.measurements.optical_rx_power_dbm?.reason ?? "";
		transmit.title = onu.measurements.optical_tx_power_dbm?.reason ?? "";
		dataInterface.textContent = onu.data_path?.interface || _("Not reported");
		firmware.textContent = formatFirmware(onu.firmware_version || onu.identity?.software_images.join("; ")).display;
		uptime.textContent = formatUptime(onu.uptime_seconds);
		age.textContent = `${onu.identity_current ? _("Identity current") : _("Identity may be stale")} · ${_("Rx / Tx measurements")}: ${[onu.measurements.optical_rx_power_dbm, onu.measurements.optical_tx_power_dbm].map((e) => (e ? `${e.source}${e.age_seconds == null ? "" : ` · ${Math.round(e.age_seconds)} s`}${e.reason ? ` · ${e.reason}` : ""}` : _("Not reported"))).join(" / ")}`;
		const sn = onu.serial_number.toUpperCase();
		pin.hidden = !pinning;
		(pin as HTMLButtonElement).disabled = !L.hasViewPermission();
		pin.textContent = pinning?.desired[sn] === undefined ? _("Pin interface") : _("Unpin");
		pin.title = pinning?.desired[sn] !== pinning?.active[sn] ? _("Pending restart") : _("Fixed interface");
	};
	update(initial, undefined);
	return { element, update };
}
export function createDeviceCards(platform: PlatformInfoReply, onSaved: (status: FttrStatus) => void) {
	const cards = new Map<number, ReturnType<typeof createCard>>();
	const grid = <div class="fttr-device-grid" />;
	const empty = (
		<div class="fttr-empty">
			<strong>{_("No identified sub-gateways yet")}</strong>
			<p>
				{_(
					"Empty hardware slots are not devices. A connected ONU will appear when its optical identity or registration is reported.",
				)}
			</p>
		</div>
	);
	const element = (
		<div>
			{empty}
			{grid}
		</div>
	);
	return {
		element,
		update(onus: SubGateway[], pinning: FttrStatus["onu_pinning"]) {
			const visible = visibleOnus(onus);
			const ids = new Set(visible.map((onu) => onu.onu_id));
			for (const [id, card] of cards)
				if (!ids.has(id)) {
					card.element.remove();
					cards.delete(id);
				}
			empty.hidden = visible.length > 0;
			for (const [index, onu] of visible.entries()) {
				let card = cards.get(onu.onu_id);
				if (!card) {
					card = createCard(onu, platform, onSaved);
					cards.set(onu.onu_id, card);
				}
				card.update(onu, pinning);
				if (grid.children[index] !== card.element)
					grid.insertBefore(card.element, grid.children[index] ?? null);
			}
		},
	};
}
