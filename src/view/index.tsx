// SPDX-License-Identifier: Apache-2.0

import { isPageHidden } from "../visibility";
import { updateBadge } from "./components/badge";
import badgeCss from "./components/badge.css?inline";
import { createDeviceCards } from "./components/device-cards";
import { formatBytes, formatLinkSpeed, formatPackets, text } from "./components/formatters";
import { createOpticalControl } from "./components/optical-control";
import { deviceState, pendingPorts, readPortConfiguration, visibleOnus } from "./components/status-model";
import { ViewStyle } from "./components/view-style";
import type { PlatformInfoReply } from "./contracts/api";
import { getNetworkDevices, getPlatformInfo, getStatus } from "./contracts/api";
import type { FttrStatus, NetworkDevices } from "./contracts/status";
import indexCss from "./index.css?inline";
import tokensCss from "./styles/tokens.css?inline";

const view = L.view;
const poll = L.Poll;

interface PortCard {
	element: HTMLElement;
	update(status: FttrStatus, devices: NetworkDevices): void;
}

function createPortCard(number: number): PortCard {
	const ifnameNode = <span />;
	const speedNode = (
		<span style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:90%">
			{_("Unknown")}
		</span>
	);
	const iconNode = <img src="/luci-static/resources/icons/port_down.svg" alt="" aria-hidden="true" />;
	const linkBarNode = <div style="flex:1;height:3px;opacity:0.25;background-color:rgb(240, 144, 144)" />;
	const portStateNode = <span />;
	const onuNode = <span />;
	const macNode = <span />;
	const txSummaryNode = <span />;
	const rxSummaryNode = <span />;
	const rxBytesNode = <span />;
	const rxPacketsNode = <span />;
	const rxMulticastNode = <span />;
	const rxErrorsNode = <span />;
	const rxDroppedNode = <span />;
	const txBytesNode = <span />;
	const txPacketsNode = <span />;
	const txErrorsNode = <span />;
	const txDroppedNode = <span />;

	const element = (
		<div
			// biome-ignore lint/a11y/useSemanticElements: composite card contains semantic detail and is activated by Enter or Space.
			role="button"
			tabIndex={0}
			class="ifacebox fttr-port-card"
			data-fttr-port={String(number)}
			style="box-sizing:border-box;margin:0;cursor:pointer"
		>
			<div class="ifacebox-head fttr-port-name" style="font-weight:bold">
				{ifnameNode}
			</div>
			<div class="ifacebox-body fttr-port-identity">
				{iconNode}
				{speedNode}
			</div>
			<div class="ifacebox-head cbi-tooltip-container" style="display:flex">
				{linkBarNode}
				<span class="cbi-tooltip left">
					<strong>{_("Port status")}: </strong>
					{portStateNode}
					<br />
					<strong>{_("ONU")}: </strong>
					{onuNode}
					<br />
					<strong>{_("MAC address")}: </strong>
					{macNode}
				</span>
			</div>
			<div class="ifacebox-body">
				<div
					class="cbi-tooltip-container fttr-port-stats"
					style="display:flex;flex-direction:column;align-items:center;font-size:80%;line-height:1.4;cursor:pointer;width:100%"
				>
					<div style="display:flex;flex-direction:column;align-items:center">
						<div style="white-space:nowrap">▲ {txSummaryNode}</div>
						<div style="white-space:nowrap">▼ {rxSummaryNode}</div>
					</div>
					<span class="cbi-tooltip">
						<span>
							<span class="nowrap">
								<strong>{_("Received bytes")}: </strong>
								{rxBytesNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Received packets")}: </strong>
								{rxPacketsNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Received multicast")}: </strong>
								{rxMulticastNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Receive errors")}: </strong>
								{rxErrorsNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Receive dropped")}: </strong>
								{rxDroppedNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Transmitted bytes")}: </strong>
								{txBytesNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Transmitted packets")}: </strong>
								{txPacketsNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Transmit errors")}: </strong>
								{txErrorsNode}
							</span>
							<br />
							<span class="nowrap">
								<strong>{_("Transmit dropped")}: </strong>
								{txDroppedNode}
							</span>
						</span>
					</span>
				</div>
			</div>
		</div>
	);

	element.addEventListener("mouseenter", () => {
		const currentOnuId = element.getAttribute("data-active-onu-id");
		if (currentOnuId !== null) {
			const targetRow = document.querySelector(`[data-fttr-onu-id="${currentOnuId}"]`);
			targetRow?.classList.add("fttr-row-highlight");
		}
	});

	element.addEventListener("mouseleave", () => {
		document.querySelectorAll(".fttr-row-highlight").forEach((el) => {
			el.classList.remove("fttr-row-highlight");
		});
	});

	element.addEventListener("click", () => {
		const currentOnuId = element.getAttribute("data-active-onu-id");
		if (currentOnuId !== null) {
			const targetRow = document.querySelector(`[data-fttr-onu-id="${currentOnuId}"]`);
			if (targetRow) {
				targetRow.scrollIntoView({
					behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
					block: "nearest",
				});
				(targetRow.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
				targetRow.classList.add("fttr-row-highlight");
				window.setTimeout(() => targetRow.classList.remove("fttr-row-highlight"), 1500);
			}
		}
	});

	element.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			element.click();
		}
	});
	element.addEventListener("focus", () => element.dispatchEvent(new MouseEvent("mouseenter")));
	element.addEventListener("blur", () => element.dispatchEvent(new MouseEvent("mouseleave")));
	return {
		element,
		update(status, devices) {
			const port = (status.switch_ports ?? []).find((item) => item.port === number);
			const ifname = port?.interface;
			const device = ifname ? devices[ifname] : undefined;
			const stats = device?.stats;
			const carrier = port?.carrier ?? device?.carrier ?? (device?.link?.speed !== undefined ? true : undefined);
			const onu = (status.sub_gateways ?? []).find((item) => item.onu_id === port?.onu_id);
			const connected = carrier === true;
			element.setAttribute(
				"aria-label",
				`${ifname ?? `${_("Port")} ${number}`} · ${carrier === true ? _("Connected") : carrier === false ? _("Disconnected") : _("Status unavailable")}${onu ? ` · ONU ${onu.onu_id}` : ""}`,
			);
			element.setAttribute("aria-disabled", String(!onu));
			const rxBytes = stats?.rx_bytes;
			const txBytes = stats?.tx_bytes;

			if (port?.onu_id !== undefined) {
				element.setAttribute("data-active-onu-id", String(port.onu_id));
			} else {
				element.removeAttribute("data-active-onu-id");
			}

			if (connected) {
				element.classList.add("port-up");
				element.classList.remove("port-down");
			} else {
				element.classList.add("port-down");
				element.classList.remove("port-up");
			}

			ifnameNode.textContent = ifname || `${_("Port")} ${number}`;
			iconNode.setAttribute("src", `/luci-static/resources/icons/${connected ? "port_up.svg" : "port_down.svg"}`);
			speedNode.textContent = connected
				? device?.link?.speed !== undefined
					? formatLinkSpeed(device.link.speed)
					: _("Connected")
				: carrier === false
					? _("Disconnected")
					: _("Status unavailable");
			speedNode.setAttribute(
				"title",
				_("速度：%s Mbit/s，双工：%s").format(text(device?.link?.speed), text(device?.link?.duplex)),
			);
			linkBarNode.style.opacity = connected ? "1" : "0.25";
			linkBarNode.style.backgroundColor = connected ? "rgb(46, 204, 113)" : "rgba(200, 200, 200, 0.4)";
			portStateNode.textContent = text(
				(port?.reserved_sn && port.onu_id === undefined ? _("Reserved (offline)") : port?.link_state) ??
					port?.status ??
					(device ? (carrier ? _("Link up") : _("Link down")) : _("Unavailable")),
			);
			if (port?.reserved_sn && port.onu_id !== undefined)
				portStateNode.textContent += ` · ${_("Fixed interface")}`;
			onuNode.textContent = text(port?.onu_sn ?? onu?.serial_number ?? port?.reserved_sn ?? port?.onu_id);
			element.title = port?.reserved_sn ? `${_("Reserved")}: ${port.reserved_sn}` : "";
			macNode.textContent = text(device?.mac);

			txSummaryNode.textContent = !connected && !txBytes ? "—" : formatBytes(txBytes);
			rxSummaryNode.textContent = !connected && !rxBytes ? "—" : formatBytes(rxBytes);
			rxBytesNode.textContent = formatBytes(rxBytes);
			rxPacketsNode.textContent = formatPackets(stats?.rx_packets);
			rxMulticastNode.textContent = formatPackets(stats?.rx_multicast ?? stats?.multicast);
			rxErrorsNode.textContent = formatPackets(stats?.rx_errors);
			rxDroppedNode.textContent = formatPackets(stats?.rx_dropped);
			txBytesNode.textContent = formatBytes(txBytes);
			txPacketsNode.textContent = formatPackets(stats?.tx_packets);
			txErrorsNode.textContent = formatPackets(stats?.tx_errors);
			txDroppedNode.textContent = formatPackets(stats?.tx_dropped);
		},
	};
}

interface StatusView {
	element: HTMLElement;
	update(status: FttrStatus, devices: NetworkDevices): void;
	setStale(stale: boolean): void;
}

function createStatusView(
	initialStatus: FttrStatus,
	initialDevices: NetworkDevices,
	platform: PlatformInfoReply,
): StatusView {
	const initialOptical = initialStatus.optical_transceiver ?? {};
	let currentDevices = initialDevices;
	const onuCards = createDeviceCards(platform, (status) => update(status, currentDevices));
	const ports = new Map<number, PortCard>();
	const portsGrid = <div class="fttr-ports-grid" />;
	const noPortsNode = <p>{_("No downstream ports are reported by the selected platform.")}</p>;

	const provisioningUnavailable = <span hidden>{_("Provisioning status unavailable")}</span>;
	const provisioningStatusNode = <span class="fttr-badge" />;
	const provisioningModeNode = <span class="fttr-badge fttr-badge-info" />;
	const provisioningRevNode = <code style="font-size:90%" />;
	const provisioningErrorNode = <span class="fttr-badge fttr-badge-danger" style="margin-left:.5em" />;
	const provisioningContents = (
		<div
			data-provisioning-summary="true"
			style="display:flex;align-items:center;flex-wrap:wrap;gap:0.75em;margin-top:.25em;margin-bottom:1.2em;font-size:92%"
		>
			<span>
				<strong style="margin-right:.4em">{_("Provisioning")}:</strong>
				{provisioningStatusNode}
			</span>
			<span>
				<span style="color:#888;margin-right:.3em">{_("Mode")}:</span>
				{provisioningModeNode}
			</span>
			<span>
				<span style="color:#888;margin-right:.3em">{_("Revision")}:</span>
				{provisioningRevNode}
			</span>
			{provisioningErrorNode}
		</div>
	);

	const provisioningNode = (
		<div>
			{provisioningUnavailable}
			{provisioningContents}
		</div>
	);
	const onlineCount = <strong />;
	const offlineCount = <strong />;
	const identifyingCount = <strong />;
	const runningCount = <strong />;
	const configuredCount = <span />;
	const pendingNode = <span class="fttr-badge fttr-badge-warning" hidden />;
	const sampledNode = <span />;
	const txPower = <strong />;
	const temperature = <strong />;
	const opticalDetail = <small />;
	const fpgaNode = <span class="fttr-badge" />;
	const opticalNode = <span>{text(initialOptical.model)}</span>;
	const cdrNode = <span class="fttr-badge" />;
	const pinningNode = <p role="status" />;
	const staleNotice = (
		<p class="alert-message warning" role="status" hidden>
			{_("Live status is unavailable. The displayed data may be stale.")}
		</p>
	);
	const opticalControl = createOpticalControl();
	poll.add(async () => {
		if (!isPageHidden() && opticalControl.element.isConnected) await opticalControl.refresh();
	}, 2);

	const element = (
		<div class="cbi-map fttr-overview">
			<ViewStyle styles={[tokensCss, badgeCss, indexCss]} />
			<header class="fttr-overview-heading">
				<div>
					<p class="fttr-eyebrow">{_("Optical network")}</p>
					<h2>{_("FTTR overview")}</h2>
					<p>{_("Registration, optical signal and synchronization at a glance.")}</p>
				</div>
				<div class="fttr-overview-actions">
					<a class="cbi-button cbi-button-action" href={L.url("admin", "network", "fttr", "topology")}>
						{_("Explore topology")}
					</a>
					<a class="cbi-button cbi-button-neutral" href={L.url("admin", "network", "fttr", "config")}>
						{_("Configure FTTR")}
					</a>
					<small>{sampledNode}</small>
				</div>
			</header>
			<div class="fttr-summary-grid">
				<div data-tone="success">
					<span>{_("Online sub-gateways")}</span>
					{onlineCount}
					<small>{_("O5 optical registration")}</small>
				</div>
				<div data-tone="neutral">
					<span>{_("Offline sub-gateways")}</span>
					{offlineCount}
					<small>{_("Known optical identities")}</small>
				</div>
				<div data-tone="info">
					<span>{_("Identifying")}</span>
					{identifyingCount}
					<small>{_("Registration in progress")}</small>
				</div>
				<a href={L.url("admin", "network", "fttr", "config")}>
					<span>{_("Running interfaces")}</span>
					{runningCount}
					<small>{configuredCount}</small>
					{pendingNode}
				</a>
			</div>
			{staleNotice}
			{opticalControl.element}
			{provisioningNode}
			{pinningNode}
			<section class="cbi-section fttr-controller">
				<div>
					<h3>{_("Controller")}</h3>
					<div class="fttr-controller-states">
						<span>
							{_("FPGA status")} {fpgaNode}
						</span>
						<span>
							{_("CDR lock")} {cdrNode}
						</span>
					</div>
					<p>
						{_("Optical module")} · {opticalNode}
					</p>
				</div>
				<div class="fttr-controller-measure">
					<span>{_("Module Tx")}</span>
					{txPower}
				</div>
				<div class="fttr-controller-measure">
					<span>{_("Temperature")}</span>
					{temperature}
				</div>
				{opticalDetail}
			</section>
			<div class="cbi-section">
				<h3>{_("Sub-gateways")}</h3>
				<p class="fttr-section-note">
					{_(
						"Optical registration and management availability are independent. Open a device for detailed diagnostics.",
					)}
				</p>
				{onuCards.element}
			</div>
			<div class="cbi-section">
				<h3>{_("Downstream ports")}</h3>
				<p class="fttr-section-note">
					{_(
						"Actual running interfaces. Saved count changes take effect only after a device reboot; interface names and connected devices remain unchanged until then.",
					)}
				</p>
				{noPortsNode}
				{portsGrid}
			</div>
		</div>
	);

	const update = (status: FttrStatus, devices: NetworkDevices) => {
		currentDevices = devices;
		const optical = status.optical_transceiver;
		const provisioning = status.provisioning;
		const pinning = status.onu_pinning;
		const onus = visibleOnus(status.sub_gateways ?? []);
		onlineCount.textContent = String(onus.filter((onu) => deviceState(onu) === "online").length);
		offlineCount.textContent = String(onus.filter((onu) => deviceState(onu) === "offline").length);
		identifyingCount.textContent = String(onus.filter((onu) => deviceState(onu) === "identifying").length);
		const config = readPortConfiguration();
		const running = new Set(status.switch_ports.map((port) => port.interface)).size;
		runningCount.textContent = String(running);
		configuredCount.textContent = `${_("Configured")}: ${config.enabled ? config.count : _("Disabled")}`;
		pendingNode.hidden = !pendingPorts(config, running);
		pendingNode.textContent = _("Pending device reboot");
		sampledNode.textContent = `${_("Last successful refresh")} · ${new Date().toLocaleTimeString()}`;
		const measured = (value: number | null, unit: string) =>
			value == null || !Number.isFinite(value) ? _("Not reported") : `${value.toFixed(2)} ${unit}`;
		txPower.textContent = measured(optical.tx_power_dbm, "dBm");
		temperature.textContent = measured(optical.temperature_celsius, "°C");
		opticalDetail.textContent = [optical.measurements.tx_power_dbm, optical.measurements.temperature_celsius]
			.map((e) =>
				e
					? `${e.source}${e.age_seconds == null ? "" : ` · ${Math.round(e.age_seconds)} s`}${e.reason ? ` · ${e.reason}` : ""}`
					: _("Measurement source not reported"),
			)
			.join(" / ");
		pinningNode.textContent = pinning
			? [
					pinning.allocation_blocked ? _("ONU allocation blocked by invalid startup configuration.") : "",
					pinning.pending_restart ? _("Fixed interface changes pending FTTR restart.") : "",
					pinning.startup_error || pinning.config_error || "",
				]
					.filter(Boolean)
					.join(" ")
			: "";
		pinningNode.hidden = !pinningNode.textContent;

		provisioningContents.hidden = !provisioning;
		provisioningUnavailable.hidden = Boolean(provisioning);
		if (provisioning) {
			updateBadge(
				provisioningStatusNode,
				provisioning.enabled ? "success" : "neutral",
				provisioning.enabled ? _("Enabled") : _("Disabled"),
			);
			provisioningModeNode.textContent = text(provisioning.mode);
			provisioningRevNode.textContent = text(provisioning.revision);
			if (provisioning.error) {
				provisioningErrorNode.textContent = provisioning.error;
				provisioningErrorNode.style.display = "";
			} else {
				provisioningErrorNode.style.display = "none";
			}
			provisioningNode.style.display = "";
		}

		if (status.fpga_status === "ready") {
			updateBadge(fpgaNode, "success", _("Ready"));
		} else if (status.fpga_status) {
			updateBadge(fpgaNode, "neutral", text(status.fpga_status));
		} else {
			updateBadge(fpgaNode, "none", "—");
		}

		opticalNode.textContent = text(optical.model);

		if (optical.cdr_locked == null) {
			updateBadge(cdrNode, "none", _("Unknown"));
		} else if (optical.cdr_locked) {
			updateBadge(cdrNode, "success", _("Locked"));
		} else {
			updateBadge(cdrNode, "warning", _("Unlocked"));
		}

		onuCards.update(onus, status.onu_pinning);
		const currentPorts = new Set<number>();
		for (const [index, portStatus] of (status.switch_ports ?? []).entries()) {
			if (currentPorts.has(portStatus.port)) continue;
			currentPorts.add(portStatus.port);
			let port = ports.get(portStatus.port);
			if (!port) {
				port = createPortCard(portStatus.port);
				ports.set(portStatus.port, port);
			}
			port.update(status, devices);
			const current = portsGrid.children.item(index);
			if (current !== port.element) portsGrid.insertBefore(port.element, current);
		}
		for (const [portNumber, port] of ports) {
			if (!currentPorts.has(portNumber)) {
				port.element.remove();
				ports.delete(portNumber);
			}
		}
		noPortsNode.hidden = currentPorts.size > 0;
	};

	update(initialStatus, initialDevices);
	return {
		element,
		update,
		setStale: (stale) => {
			staleNotice.hidden = !stale;
		},
	};
}

let pageRoot: HTMLElement | null = null;
let pageView: StatusView | null = null;
let refreshing = false;
let lastSuccess = Date.now();

export const main = view.extend({
	async load(): Promise<{ status: FttrStatus; devices: NetworkDevices; platform: PlatformInfoReply }> {
		await L.uci.load("fttr");
		const [status, deviceResult, platform] = await Promise.all([
			getStatus(),
			getNetworkDevices().catch((error) => {
				console.warn("Failed to load network device details", error);
				return {};
			}),
			getPlatformInfo(),
		]);
		return { status, devices: deviceResult, platform };
	},
	render(data: { status: FttrStatus; devices: NetworkDevices; platform: PlatformInfoReply }): HTMLElement {
		lastSuccess = Date.now();
		pageView = createStatusView(data.status, data.devices, data.platform);
		pageRoot = pageView.element;
		poll.add(async () => {
			if (refreshing || isPageHidden() || !pageRoot?.isConnected || !pageView) return;
			const activeView = pageView;
			refreshing = true;
			try {
				const [status, devices] = await Promise.all([getStatus(), getNetworkDevices().catch(() => ({}))]);
				if (pageView === activeView && activeView.element.isConnected) activeView.update(status, devices);
				lastSuccess = Date.now();
				activeView.setStale(false);
			} catch (error) {
				console.error("Failed to refresh FTTR status", error);
				activeView.setStale(Date.now() - lastSuccess > 30000);
			} finally {
				refreshing = false;
			}
		}, 10);
		return pageRoot;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
