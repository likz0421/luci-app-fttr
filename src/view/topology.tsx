// SPDX-License-Identifier: Apache-2.0
// Lightweight, deterministic FTTR topology built from the stable get_status
// contract. It replaces the upstream AntV G6 snapshot graph, which depended on
// three fragile ubus methods (get_topology / _node / _clients) and produced
// "sources unavailable / stale snapshot / issues" on custom firmware.
import { isPageHidden } from "../visibility";
import {
	getRegistrationBadgeSpec,
	getWifiSyncBadgeSpec,
} from "./components/badge";
import badgeCss from "./components/badge.css?inline";
import { formatLinkSpeed, text } from "./components/formatters";
import { ViewStyle } from "./components/view-style";
import type { PlatformInfoReply } from "./contracts/api";
import { getNetworkDevices, getPlatformInfo, getStatus } from "./contracts/api";
import type { FttrStatus, NetworkDevices, SubGateway, SwitchPortStatus } from "./contracts/status";
import topologyLiteCss from "./topology-lite.css?inline";
import tokensCss from "./styles/tokens.css?inline";

const view = L.view;
const poll = L.Poll;
const uci = L.uci;

const REFRESH_INTERVAL = 10;

/** H3C HM2004-DU: only render the downstream ports actually bridged into br-lan. */
function activePortLimit(platform: PlatformInfoReply): number {
	if (platform.platform_id !== "h3c-hm2004-du") return 0;
	try {
		const raw = Number(uci.get("fttr", "h3c", "lan_ports") || 0);
		return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 16) : 0;
	} catch {
		return 0;
	}
}

function onuLabel(onu: SubGateway): string {
	return onu.serial_number || onu.identity?.equipment_id || `#${onu.onu_id}`;
}

interface Branch {
	port: SwitchPortStatus | null;
	onu: SubGateway | null;
	device: NetworkDevices[string] | undefined;
}

function branchList(status: FttrStatus, devices: NetworkDevices, portLimit: number): Branch[] {
	const onus = status.sub_gateways ?? [];
	const reported = status.switch_ports ?? [];
	const ports = portLimit > 0 ? reported.filter((p) => p.port <= portLimit) : reported;

	if (ports.length) {
		return ports.map((port) => ({
			port,
			onu: onus.find((o) => o.onu_id === port.onu_id) ?? null,
			device: port.interface ? devices[port.interface] : undefined,
		}));
	}

	// Fallback: no switch_ports reported. Derive one branch per ONU so the
	// topology still renders something meaningful.
	return onus.map((onu) => ({
		port: null,
		onu,
		device: onu.data_path?.interface ? devices[onu.data_path.interface] : undefined,
	}));
}

interface FieldCard {
	element: HTMLElement;
	set(kind: string, value: string): void;
}

function createCard(title: string): FieldCard {
	const el = (
		<div class="tlt-card">
			<div class="tlt-card-title">{title}</div>
			<div class="tlt-card-body" />
		</div>
	) as HTMLElement;
	const body = el.querySelector(".tlt-card-body") as HTMLElement;
	const fields = new Map<string, HTMLElement>();
	return {
		element: el,
		set(kind, value) {
			let row = fields.get(kind);
			if (!row) {
				row = (
					<div class="tlt-row">
						<span class="tlt-key" />
						<span class="tlt-val" />
					</div>
				) as HTMLElement;
				(row.querySelector(".tlt-key") as HTMLElement).textContent = kind;
				fields.set(kind, row);
				body.append(row);
			}
			(row.querySelector(".tlt-val") as HTMLElement).textContent = value;
		},
	};
}

interface Page {
	element: HTMLElement;
	update(status: FttrStatus, devices: NetworkDevices): void;
	destroy(): void;
}

function createPage(
	initialStatus: FttrStatus,
	initialDevices: NetworkDevices,
	platform: PlatformInfoReply,
	portLimit: number,
): Page {
	let dead = false;
	let refreshing = false;
	const controllerCard = createCard(_("OLT controller"));
	const portCards = new Map<number, FieldCard>();
	const branches = <div class="tlt-branches" />;
	const summary = <div class="tlt-summary" />;
	const updated = <span class="tlt-updated" />;
	const staleNotice = (
		<p class="alert-message warning" role="status" hidden>
			{_("Live status is unavailable. The displayed data may be stale.")}
		</p>
	);

	const element = (
		<div class="cbi-map tlt-page">
			<ViewStyle styles={[tokensCss, badgeCss, topologyLiteCss]} />
			<header class="tlt-header">
				<div>
					<h2>{_("FTTR topology")}</h2>
					<p class="tlt-subtitle">{_("Live PON links and registered sub-gateways")}</p>
				</div>
				<div class="tlt-head-meta">
					{summary}
					{updated}
				</div>
			</header>
			{staleNotice}
			<div class="tlt-tree">
				<div class="tlt-root-row">{controllerCard.element}</div>
				<div class="tlt-spine" />
				{branches}
			</div>
			<footer class="tlt-footer">
				<span>{_("Auto-refresh: %s s").format(String(REFRESH_INTERVAL))}</span>
				<span>{_("Port count follows FTTR → Configuration → Basic")}</span>
			</footer>
		</div>
	) as HTMLElement;

	function renderBranch(branch: Branch, index: number): HTMLElement {
		const { port, onu, device } = branch;
		const portNo = port?.port ?? (onu ? onu.onu_id + 1 : index + 1);
		let card = portCards.get(portNo);
		if (!card) {
			card = createCard(_("Downstream port %s").format(String(portNo)));
			portCards.set(portNo, card);
		}
		const ifname = port?.interface ?? onu?.data_path?.interface ?? "—";
		card.set(_("Interface"), text(ifname));
		card.set(_("Link"), port?.status ?? (device?.carrier ? "UP" : "DOWN"));
		if (device?.link?.speed !== undefined) card.set(_("Speed"), formatLinkSpeed(device.link.speed));
		if (onu) {
			card.set(_("ONU"), onuLabel(onu));
			card.set(_("Registration"), getRegistrationBadgeSpec(onu.state).label);
			card.set(_("Wi-Fi"), getWifiSyncBadgeSpec(onu.wifi_sync).label);
		} else {
			card.set(_("ONU"), port?.reserved_sn ? _("Reserved: %s").format(port.reserved_sn) : "—");
		}
		card.element.classList.toggle("is-up", Boolean(port?.carrier || device?.carrier));
		card.element.dataset.onuId = onu ? String(onu.onu_id) : "";

		const wrap = (
			<div class="tlt-branch">
				<div class="tlt-branch-link" />
				{card.element}
			</div>
		) as HTMLElement;
		wrap.dataset.port = String(portNo);
		return wrap;
	}

	const update = (status: FttrStatus, devices: NetworkDevices) => {
		if (dead) return;
		const optical = status.optical_transceiver ?? {};
		controllerCard.set(_("Model"), text(platform.model || optical.model || platform.vendor));
		controllerCard.set(_("Controller"), status.fpga_status ? text(status.fpga_status) : "—");
		controllerCard.set(_("Optical module"), text(optical.model));
		controllerCard.set(
			_("TX power"),
			optical.tx_power_dbm == null ? "—" : `${optical.tx_power_dbm.toFixed(2)} dBm`,
		);
		controllerCard.set(
			_("Rate"),
			`${optical.phy_rate_downlink_gbps ?? "—"} / ${optical.phy_rate_uplink_gbps ?? "—"} Gbps`,
		);

		const list = branchList(status, devices, portLimit);
		const seen = new Set<number>();
		list.forEach((branch, index) => {
			const portNo = branch.port?.port ?? (branch.onu ? branch.onu.onu_id + 1 : index + 1);
			seen.add(portNo);
			const wrap = renderBranch(branch, index);
			const current = branches.children.item(index);
			if (current !== wrap) branches.insertBefore(wrap, current);
		});
		while (branches.children.length > list.length) branches.lastElementChild?.remove();
		for (const [portNo, card] of portCards) if (!seen.has(portNo)) portCards.delete(portNo);

		const onus = status.sub_gateways ?? [];
		summary.replaceChildren(
			<span class="tlt-count">
				<strong>{String(list.length)}</strong> {_("ports")}
			</span>,
			<span class="tlt-count">
				<strong>{String(onus.filter((o) => o.state === "o5_operation").length)}</strong> {_("registered")}
			</span>,
			<span class="tlt-count">
				<strong>{String(onus.length)}</strong> {_("known ONUs")}
			</span>,
		);
		updated.textContent = `${_("Updated")} ${new Date().toLocaleTimeString()}`;
	};

	const tick = async () => {
		if (dead || refreshing || !element.isConnected || isPageHidden()) return;
		refreshing = true;
		try {
			const [status, devices] = await Promise.all([getStatus(), getNetworkDevices().catch(() => ({}))]);
			update(status, devices);
			staleNotice.hidden = true;
		} catch (error) {
			console.error("FTTR topology refresh failed", error);
			staleNotice.hidden = false;
		} finally {
			refreshing = false;
		}
	};
	poll.add(tick, REFRESH_INTERVAL);
	update(initialStatus, initialDevices);

	const destroy = () => {
		if (dead) return;
		dead = true;
		poll.remove(tick);
	};
	return { element, update, destroy };
}

let activePage: Page | null = null;

export const main = view.extend({
	async load(): Promise<{
		status: FttrStatus;
		devices: NetworkDevices;
		platform: PlatformInfoReply;
		portLimit: number;
	}> {
		const [status, deviceResult, platform] = await Promise.all([
			getStatus(),
			getNetworkDevices().catch(() => ({})),
			getPlatformInfo(),
		]);
		await uci.load("fttr").catch(() => undefined);
		return { status, devices: deviceResult, platform, portLimit: activePortLimit(platform) };
	},
	render(data: {
		status: FttrStatus;
		devices: NetworkDevices;
		platform: PlatformInfoReply;
		portLimit: number;
	}): HTMLElement {
		activePage?.destroy();
		activePage = createPage(data.status, data.devices, data.platform, data.portLimit);
		return activePage.element;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
