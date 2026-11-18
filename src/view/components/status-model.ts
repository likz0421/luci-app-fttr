// SPDX-License-Identifier: Apache-2.0
import type { SubGateway } from "../contracts/status";

/** Empty FPGA slots are not devices. Vendor recognition is never identity evidence. */
export function identityText(value: string | null | undefined): string | null {
	const text = value?.trim();
	return !text || /^(unknown|n\/a|none|null|undefined|[-—]+)$/i.test(text) || /^[0f: -]+$/i.test(text) ? null : text;
}
export function hasDeviceEvidence(onu: SubGateway): boolean {
	return Boolean(
		identityText(onu.serial_number) ||
			identityText(onu.identity?.equipment_id) ||
			["o3_serial_number", "o4_ranging", "o5_operation", "o6_intermittent_lods"].includes(onu.state),
	);
}
export function visibleOnus(onus: SubGateway[]): SubGateway[] {
	const unique = new Map<string, SubGateway>();
	const score = (onu: SubGateway) =>
		Number(onu.state === "o5_operation") * 4 + Number(onu.identity_current) * 2 + Number(Boolean(onu.identity));
	for (const onu of onus) {
		if (!hasDeviceEvidence(onu)) continue;
		const serial = identityText(onu.serial_number)?.toUpperCase();
		const key = serial ? `serial:${serial}` : `id:${onu.onu_id}`;
		const previous = unique.get(key);
		if (!previous || score(onu) > score(previous)) unique.set(key, onu);
	}
	return [...unique.values()].sort((a, b) => a.onu_id - b.onu_id);
}
export function deviceState(onu: SubGateway): "online" | "offline" | "identifying" {
	if (onu.state === "o5_operation") return "online";
	return ["o3_serial_number", "o4_ranging"].includes(onu.state) ? "identifying" : "offline";
}
export interface PortConfiguration {
	enabled: boolean;
	count: number;
}
export function portConfiguration(enabled: unknown, count: unknown): PortConfiguration {
	const number = Number(count);
	// Match the disabled UCI aliases accepted by the backend and boot helper.
	// Missing values retain the historical enabled default.
	const disabled = enabled === "0" || enabled === "false" || enabled === "no" || enabled === "off";
	return { enabled: !disabled, count: Number.isInteger(number) && number >= 1 && number <= 16 ? number : 16 };
}
export function readPortConfiguration(): PortConfiguration {
	return portConfiguration(L.uci.get("fttr", "ports", "enabled"), L.uci.get("fttr", "ports", "count"));
}
export function pendingPorts(config: PortConfiguration, running: number | null): boolean {
	return running !== null && running !== (config.enabled ? config.count : 0);
}
