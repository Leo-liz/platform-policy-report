import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backfillPlan,buildBackfillMessage,historicalSnapshots,validateBackfill} from '../lib/backfill.js';
import {loadCatalog} from '../lib/catalog.js';
import {buildMarkdownNotification,validateDispatchPayload} from '../lib/routing.js';
import {sendWorkNotification} from '../lib/dingtalk.js';

const e={event_id:'source-a::detail:0',content_hash:'a'.repeat(64),platform_code:'ozon',platform_label:'Ozon',primary_tag_label:'API',ai_summary_zh:'已核实变更。需要回归。',recommended_action:'检查调用。',change_url:'https://example.com/official',official_date:'2026-09-29'};
const p={run_id:'20261010-110000',report_date:'2026-10-09',events:[e],backfill:{start_date:'2026-09-29',end_date:'2026-10-09',mode:'preview',occurrences:[{canonical_event_id:e.event_id,event_id:e.event_id,content_hash:e.content_hash,report_date:'2026-09-29',run_id:'20260930-100002'}]}};
const r={recipient_id:'private-id',display_name:'已配置人',dingtalk_user_id:'private-user',events:[e]};
test('recovery requires exact authorized range, explicit mode, dated provenance',()=>{
  validateBackfill(p);
  assert.throws(()=>validateBackfill({...p,backfill:{...p.backfill,end_date:'2026-10-10'}}));
  assert.throws(()=>validateBackfill({...p,backfill:{...p.backfill,mode:'anything'}}));
  assert.throws(()=>validateBackfill({...p,backfill:{...p.backfill,occurrences:[]}}));
});
test('actual delivered content is excluded per person across dates and changing event IDs',()=>{
  const plan=backfillPlan([r,{...r,recipient_id:'other'}],[{recipient_id:r.recipient_id,status:'delivered',content_hash:e.content_hash,event_id:'old-id'}],[e]);
  assert.equal(plan.recipients.length,1); assert.equal(plan.recipients[0].recipient_id,'other');
  assert.equal(plan.summary.already_delivered_assignments,1);
});
test('accepted or pending is uncertain, failed may retry; unmatched remains explicit',()=>{
  for(const status of ['accepted','pending']) assert.equal(backfillPlan([r],[{recipient_id:r.recipient_id,status,content_hash:e.content_hash}],[e]).summary.uncertain_assignments,1);
  assert.equal(backfillPlan([r],[{recipient_id:r.recipient_id,status:'failed',content_hash:e.content_hash}],[e]).recipients.length,1);
  assert.deepEqual(backfillPlan([],[],[e]).summary.unmatched_event_ids,[e.event_id]);
});
test('one message clearly labels historical range with facts, action and immutable dated links',()=>{
  const message=buildBackfillMessage(r,p);
  for(const marker of ['历史汇总补发','2026-09-29 至 2026-10-09','检查调用','https://example.com/official','html_report_20260929.html']) assert.ok(message.text.includes(marker));
  assert.throws(()=>buildBackfillMessage(r,p,10),/safe size/);
});
test('historical snapshots use original day and IDs and expose no private IDs',()=>{
  const snapshots=historicalSnapshots(p,[r],[{recipient_id:r.recipient_id,event_id:'aggregate',content_hash:e.content_hash,status:'delivered',updated_at:'2026-10-10T00:00:00Z'}]);
  assert.equal(snapshots[0].report_date,'2026-09-29');
  assert.equal(snapshots[0].events[0].owners[0].notification_status,'delivered');
  assert.doesNotMatch(JSON.stringify(snapshots),/private-id|private-user|recipient_id|dingtalk_user_id/);
});
test('actual recovery payload is trusted and every event fits one aggregate message',()=>{
  const payload=validateDispatchPayload(JSON.parse(readFileSync(new URL('../reports/notification-backfill-20260929-20261009.json',import.meta.url))),loadCatalog());
  validateBackfill(payload);
  const message=buildBackfillMessage({events:payload.events},payload);
  assert.ok(message.text.length<=4500);
  assert.ok(message.text.includes(`${payload.events.length} 条`));
  assert.ok(message.text.includes('notification-recovery-20260929-20261009.html'));
  for(const platform of new Set(payload.events.map(e=>e.platform_label))) assert.ok(message.text.includes(platform));
});
test('future daily digest compacts before DingTalk 5000 character boundary',()=>{
  const payload=JSON.parse(readFileSync(new URL('../reports/notification-backfill-20260929-20261009.json',import.meta.url)));
  assert.ok(buildMarkdownNotification({events:payload.events},payload).text.length<=5000);
});
test('oversized message is rejected before any token or HTTP request',async()=>{
  let called=false;
  await assert.rejects(sendWorkNotification('never-sent',{text:'x'.repeat(5001)},()=>{called=true;}),/5000/);
  assert.equal(called,false);
});
