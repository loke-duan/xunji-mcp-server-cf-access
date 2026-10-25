import { bodyDescription } from "./tool-descriptions.ts";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { postXunji, toolData, toolError } from "./xunji-api.ts";

export interface BodyEnv { XUNJI_BODY_API_KEY?: string }
export const bodyType = z.enum(["weight", "bodyfat", "neck", "chest", "weist", "shoulder", "bot", "arm_left", "arm_right", "forearm_left", "forearm_right", "leg_left", "leg_right", "cav_left", "cav_right"]);
export const bodyQueryInput = z.object({
 start_date: z.iso.date().describe("用户时区的开始日期 YYYY-MM-DD，包含该日；不得晚于 end_date。"),
 end_date: z.iso.date().describe("用户时区的结束日期 YYYY-MM-DD，包含该日；单日与 start_date 相同。"),
 types: z.array(bodyType).optional().describe("省略时查询全部指标。仅体重用 [weight]，仅体脂用 [bodyfat]，腰围用 [weist]；完整中文映射见工具说明。"),
 include_latest: z.boolean().default(true).describe("默认 true，返回各类型 latest；其日期范围语义未获上游确认，须核对记录日期。"),
 include_records: z.boolean().default(true).describe("默认 true，返回历史明细 records；趋势、比较及完整历史查询应为 true。"),
 limit: z.number().int().min(1).max(500).default(500).describe("每页记录上限1–500，默认500；结果满页时可能还有后续页。"),
 offset: z.number().int().min(0).default(0).describe("跳过的记录数，默认0；继续分页时增加已取得的记录数，沿用其他查询条件。"),
}).refine(v => v.start_date <= v.end_date, "start_date must not exceed end_date");
export async function queryBody(env: BodyEnv, input: z.input<typeof bodyQueryInput>, fetcher: typeof fetch = fetch) {
 const parsed = bodyQueryInput.safeParse(input);
 if (!parsed.success) return toolError("XUNJI_BODY_INPUT: Invalid date range, measurement type or pagination.");
 const r = await postXunji("bodyQuery", env.XUNJI_BODY_API_KEY, parsed.data, fetcher);
 return r.ok ? toolData(r.data, env.XUNJI_BODY_API_KEY!) : toolError(r.error);
}
export function registerBodyTools(server: McpServer, env: BodyEnv, authenticated: boolean) {
 server.registerTool("xunji_get_body", {
  description: bodyDescription, inputSchema: bodyQueryInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
 }, async input => authenticated ? queryBody(env, input) : toolError("Sign in before reading body data."));
}
