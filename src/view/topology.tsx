// SPDX-License-Identifier: Apache-2.0
// Deterministic FTTR topology built from the stable get_status contract.
// Pure DOM/SVG: no canvas, no AntV G6, no fragile snapshot ubus chain.
// The number of branches equals the ports the backend actually bridges.
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

const REFRESH_INTERVAL = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

function onuLabel(onu: SubGateway): string {
	return onu.serial_number || onu.identity?.equipment_id || `#${onu.onu_id}`;
}

interface Branch {
	port: SwitchPortStatus | null;
	onu: SubGateway | null;
	device: NetworkDevices[string] | undefined;
}

function branchList(status: FttrStatus, devices: NetworkDevices): Branch[] {
	const onus = status.sub_gateways ?? [];
	// Backend reports exactly the bridged ports; use it as-is (single source of truth).
	const ports = status.switch_ports ?? [];
	if (ports.length) {
		return ports.map((port) => ({
			port,
			onu: onus.find((o) => o.onu_id === port.onu_id) ?? null,
			device: port.interface ? devices[port.interface] : undefined,
		}));
	}
	// Fallback: no switch_ports reported — one branch per known ONU.
	return onus.map((onu) => ({
		port: null,
		onu,
		device: onu.data_path?.interface ? devices[onu.data_path.interface] : undefined,
	}));
}

function isUp(branch: Branch): boolean {
	return Boolean(branch.port?.carrier || branch.device?.carrier);
}

function branchNumber(branch: Branch, index: number): number {
	return branch.port?.port ?? (branch.onu ? branch.onu.onu_id + 1 : index + 1);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
	return el;
}

interface FieldCard {
	element: HTMLElement;
	set(kind: string, value: string): void;
}

function createCard(title: string): FieldCard {
	const el = (
		<div class="tlt-detail-card">
			<div class="tlt-detail-title">{title}</div>
			<div class="tlt-detail-body" />
		</div>
	) as HTMLElement;
	const body = el.querySelector(".tlt-detail-body") as HTMLElement;
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
): Page {
	let dead = false;
	let refreshing = false;
	const summary = <div class="tlt-summary tlt-head-meta" />;
	const updated = <span class="tlt-updated" />;
	const staleNotice = (
		<p class="alert-message warning" role="status" hidden>
			{_("Live status is unavailable. The displayed data may be stale.")}
		</p>
	);
	const canvas = <div class="tlt-canvas" />;
	const detail = <div class="tlt-detail" />;

	const element = (
		<div class="cbi-map tlt-page">
			<ViewStyle styles={[tokensCss, badgeCss, topologyLiteCss]} />
			<header class="tlt-header">
				<div>
					<h2>{_("FTTR topology")}</h2>
					<p class="tlt-subtitle">{_("PON links from the OLT controller to each active downstream port")}</p>
				</div>
				<div class="tlt-head-meta">
					{summary}
					{updated}
				</div>
			</header>
			{staleNotice}
			{canvas}
			{detail}
			<footer class="tlt-footer">
				<span>{_("Auto-refresh: %s s").format(String(REFRESH_INTERVAL))}</span>
				<span>{_("Port count follows the bridged ports reported by the controller")}</span>
			</footer>
		</div>
	) as HTMLElement;

	const detailCards = new Map<number, FieldCard>();

	function drawSvg(list: Branch[]): void {
		const width = Math.max(480, list.length * 150 + 120);
		const rootY = 34;
		const leafY = 138;
		const rootX = width / 2;
		const svg = svgEl("svg", {
			class: "tlt-svg",
			viewBox: `0 0 ${width} 210`,
			preserveAspectRatio: "xMidYMid meet",
			role: "img",
		});
		const title = svgEl("title");
		title.textContent = _("FTTR PON topology");
		svg.append(title);

		const leafXs = list.map((_, i) => {
			if (list.length === 1) return rootX;
			const span = width - 160;
			return 80 + (span * i) / (list.length - 1);
		});

		// Links first so nodes render on top.
		list.forEach((branch, i) => {
			const up = isUp(branch);
			const x = leafXs[i] ?? rootX;
			const path = svgEl("path", {
				class: `tlt-link${up ? " is-up" : ""}`,
				d: `M ${rootX} ${rootY + 26} C ${rootX} ${(rootY + leafY) / 2}, ${x} ${(rootY + leafY) / 2}, ${x} ${leafY - 26}`,
			});
			svg.append(path);
		});

		// Root node (OLT controller).
		const rootW = 150;
		svg.append(
			svgEl("rect", {
				class: "tlt-node-box is-root",
				x: rootX - rootW / 2,
				y: rootY,
				width: rootW,
				height: 52,
				rx: 10,
			}),
		);
		const rootTitle = svgEl("text", {
			class: "tlt-node-title",
			x: rootX,
			y: rootY + 21,
			"text-anchor": "middle",
		});
		rootTitle.textContent = _("OLT controller");
		const rootSub = svgEl("text", {
			class: "tlt-node-sub",
			x: rootX,
			y: rootY + 39,
			"text-anchor": "middle",
		});
		rootSub.textContent = text(platform.model || platform.vendor || "HM2004-DU").slice(0, 22);
		svg.append(rootTitle, rootSub);

		// Leaf nodes (downstream ports).
		list.forEach((branch, i) => {
			const up = isUp(branch);
			const x = leafXs[i] ?? rootX;
			const no = branchNumber(branch, i);
			const w = 132;
			svg.append(
				svgEl("rect", {
					class: `tlt-node-box${up ? " is-up" : ""}`,
					x: x - w / 2,
					y: leafY,
					width: w,
					height: 56,
					rx: 8,
				}),
			);
			const t = svgEl("text", {
				class: "tlt-node-title",
				x,
				y: leafY + 19,
				"text-anchor": "middle",
			});
			t.textContent = _("Port %s").format(String(no));
			const s = svgEl("text", {
				class: "tlt-node-sub",
				x,
				y: leafY + 35,
				"text-anchor": "middle",
			});
			s.textContent = text(branch.port?.interface ?? branch.onu?.data_path?.interface ?? "—");
			const badge = svgEl("text", {
				class: `tlt-node-badge${up ? " is-up" : ""}`,
				x,
				y: leafY + 50,
				"text-anchor": "middle",
			});
			const state = branch.onu ? getRegistrationBadgeSpec(branch.onu.state).label : branch.port?.status ?? (up ? "UP" : "DOWN");
			badge.textContent = `${up ? "● " : "○ "}${state}`.slice(0, 20);
			svg.append(t, s, badge);
		});

		canvas.replaceChildren(svg);
	}

	function renderDetail(status: FttrStatus, devices: NetworkDevices, list: Branch[]): void {
		const seen = new Set<number>();
		list.forEach((branch, index) => {
			const no = branchNumber(branch, index);
			seen.add(no);
			let card = detailCards.get(no);
			if (!card) {
				card = createCard(_("Downstream port %s").format(String(no)));
				detailCards.set(no, card);
			}
			const { port, onu, device } = branch;
			card.set(_("Interface"), text(port?.interface ?? onu?.data_path?.interface ?? "—"));
			card.set(_("Link"), port?.status ?? (device?.carrier ? "UP" : "DOWN"));
			if (device?.link?.speed !== undefined) card.set(_("Speed"), formatLinkSpeed(device.link.speed));
			if (onu) {
				card.set(_("ONU"), onuLabel(onu));
				card.set(_("Registration"), getRegistrationBadgeSpec(onu.state).label);
				card.set(_("Wi-Fi"), getWifiSyncBadgeSpec(onu.wifi_sync).label);
			} else {
				card.set(_("ONU"), port?.reserved_sn ? _("Reserved: %s").format(port.reserved_sn) : "—");
			}
			card.element.classList.toggle("is-up", isUp(branch));
		});
		// Rebuild the detail container in branch order, dropping stale cards.
		const nodes: HTMLElement[] = [];
		list.forEach((branch, index) => {
			const card = detailCards.get(branchNumber(branch, index));
			if (card) nodes.push(card.element);
		});
		detail.replaceChildren(...nodes);
		for (const no of detailCards.keys()) if (!seen.has(no)) detailCards.delete(no);
	}

	const update = (status: FttrStatus, devices: NetworkDevices) => {
		if (dead) return;
		const list = branchList(status, devices);
		drawSvg(list);
		renderDetail(status, devices, list);

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
	}> {
		const [status, deviceResult, platform] = await Promise.all([
			getStatus(),
			getNetworkDevices().catch(() => ({})),
			getPlatformInfo(),
		]);
		return { status, devices: deviceResult, platform };
	},
	render(data: {
		status: FttrStatus;
		devices: NetworkDevices;
		platform: PlatformInfoReply;
	}): HTMLElement {
		activePage?.destroy();
		activePage = createPage(data.status, data.devices, data.platform);
		return activePage.element;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
