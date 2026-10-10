import { buildPublicReportSnapshot } from './routing.js';

export function validateBackfill(payload) {
  const batch = payload.backfill;
  if (!batch) return;
  // This endpoint extension is narrowly authorized for this recovery only.
  if (batch.start_date !== '2026-09-29' || batch.end_date !== '2026-10-09' ||
      payload.report_date !== batch.end_date || !Array.isArray(batch.occurrences) ||
      !['preview', 'send'].includes(batch.mode)) throw new Error('invalid authorized backfill range or mode');
  const events = new Map(payload.events.map(e => [e.event_id, e]));
  const covered = new Set();
  for (const item of batch.occurrences) {
    const event = events.get(item.canonical_event_id);
    if (!event || event.content_hash !== item.content_hash || !item.event_id ||
        !/^\d{8}-\d{6}$/.test(item.run_id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.report_date) ||
        item.report_date < batch.start_date || item.report_date > batch.end_date) {
      throw new Error('invalid historical evidence occurrence');
    }
    covered.add(event.event_id);
  }
  if (covered.size !== events.size) throw new Error('historical event lacks dated provenance');
}

export function backfillPlan(routed, deliveryRows, events) {
  let alreadyDelivered = 0;
  let uncertain = 0;
  const planned = routed.map(recipient => {
    const rows = deliveryRows.filter(row => row.recipient_id === recipient.recipient_id);
    const delivered = new Set(rows.filter(row => row.status === 'delivered').map(row => row.content_hash));
    const unresolved = new Set(rows.filter(row => ['accepted', 'pending'].includes(row.status)).map(row => row.content_hash));
    return {...recipient, events: recipient.events.filter(event => {
      if (delivered.has(event.content_hash)) { alreadyDelivered++; return false; }
      if (unresolved.has(event.content_hash)) { uncertain++; return false; }
      return true;
    })};
  }).filter(recipient => recipient.events.length);
  const matched = new Set(routed.flatMap(recipient => recipient.events.map(e => e.event_id)));
  return {recipients: planned, summary: {
    matched_people: routed.length,
    people_to_notify: planned.length,
    event_assignments: planned.reduce((sum, recipient) => sum + recipient.events.length, 0),
    already_delivered_assignments: alreadyDelivered,
    uncertain_assignments: uncertain,
    unmatched_event_ids: events.filter(event => !matched.has(event.event_id)).map(event => event.event_id),
  }};
}

export function buildBackfillMessage(recipient, payload, maxChars = 4500) {
  const batch = payload.backfill;
  const datesFor = event => [...new Set(batch.occurrences.filter(item => item.canonical_event_id === event.event_id).map(item => item.report_date))].sort();
  const events = [...recipient.events].sort((a,b) => `${datesFor(a)[0]}:${a.platform_code}:${a.event_id}`.localeCompare(`${datesFor(b)[0]}:${b.platform_code}:${b.event_id}`));
  const header = `### 平台政策历史汇总补发（${batch.start_date} 至 ${batch.end_date}）\n\n按现有负责人规则合并 ${events.length} 条尚未成功通知的有效变更；重复公告已合并。下列日期为报告日期，官方日期以各条正文为准。`;
  const blocks = compact => events.map((event,index) => `\n\n**${index+1}. ${event.platform_label}｜${event.primary_tag_label}｜报告 ${datesFor(event).join('、')}**\n\n官方日期：${event.official_date || '未明确'}\n\n${compact ? event.ai_summary_zh.slice(0,100) : event.ai_summary_zh}\n\n建议：${compact ? event.recommended_action.slice(0,70) : event.recommended_action}\n\n[查看变更](${event.change_url})`).join('');
  const dates = [...new Set(batch.occurrences.map(item => item.report_date))].sort();
  const footer = '\n\n逐日日报：\n' + dates.map(day => `[${day}](https://leo-liz.github.io/platform-policy-report/reports/html_report_${day.replaceAll('-','')}.html)`).join(' · ');
  let text = header + blocks(false) + footer;
  if (text.length > maxChars) text = header + blocks(true) + footer;
  if (text.length > maxChars) {
    const excerpt = (value, limit) => value.length > limit ? value.slice(0,limit) + '…' : value;
    text = header + '\n\n以下为逐项摘要和建议节选；完整正文依据、官方链接及行动要求见对应日期日报。' + events.map((event,index) =>
      `\n\n**${index+1}. ${event.platform_label}｜${event.primary_tag_label}**（报告 ${datesFor(event).map(day=>day.slice(5)).join('、')}；官方 ${event.official_date || '未明确'}）\n${excerpt(event.ai_summary_zh,42)} 建议：${excerpt(event.recommended_action,24)}`
    ).join('') + footer;
  }
  if (text.length > maxChars) {
    const groups = new Map();
    for (const event of events) {
      if (!groups.has(event.platform_label)) groups.set(event.platform_label,[]);
      groups.get(event.platform_label).push(event);
    }
    text = header + '\n\n条目较多，以下按平台汇总并列出重点节选；全部匹配条目的完整摘要、建议、官方日期及链接均已收录在历史汇总页面，未删除或拆成多条消息。' + [...groups].map(([platform,items])=>
      `\n\n**${platform}：${items.length} 条**｜${[...new Set(items.map(e=>e.primary_tag_label))].join('、')}\n重点：${items[0].ai_summary_zh.slice(0,140)}\n建议：${items[0].recommended_action.slice(0,80)}`
    ).join('') + '\n\n[查看全部历史变更与逐项建议](https://leo-liz.github.io/platform-policy-report/reports/notification-recovery-20260929-20261009.html)' + footer;
  }
  // Never silently omit an event or split a recipient into multiple messages.
  if (text.length > maxChars) throw new Error('aggregate message exceeds safe size');
  return {title: `平台政策历史补发 ${batch.start_date}—${batch.end_date}`, text};
}

export function historicalSnapshots(payload, routed, deliveryRows) {
  return [...new Set(payload.backfill.occurrences.map(item => item.report_date))].sort().map(day => {
    const occurrences = payload.backfill.occurrences.filter(item => item.report_date === day);
    const byId = new Map(payload.events.map(event => [event.event_id,event]));
    const aliases = occurrences.map(item => ({...byId.get(item.canonical_event_id), event_id:item.event_id}));
    const recipients = routed.map(recipient => ({...recipient, events: aliases.filter(alias => recipient.events.some(event => event.content_hash === alias.content_hash))}));
    const rows = deliveryRows.flatMap(row => occurrences.filter(item => item.content_hash === row.content_hash).map(item => ({...row,event_id:item.event_id})));
    return buildPublicReportSnapshot({...payload,report_date:day,run_id:occurrences[0].run_id,events:aliases},recipients,rows);
  });
}
