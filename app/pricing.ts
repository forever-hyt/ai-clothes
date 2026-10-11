// 生成质量与演示 Credits 定价：客户端与服务端共享的单一成本来源。
// 服务端实际扣费始终以这里（经 demo-provider 重导出）的数值为准，客户端仅用于展示。
export type Quality = 'standard' | 'hd';
export const QUALITY_COST: Record<Quality, number> = { standard: 2, hd: 5 };
export const QUALITIES: Quality[] = ['standard', 'hd'];
