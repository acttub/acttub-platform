package com.acttub.readinglive

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** JS lib/reading/live.ts 의 LiveState. 글은 모두 JS 가 만든다. */
class LiveState : Record {
  @Field var scene: String = ""
  @Field var shortProgress: String = ""
  @Field var initial: String = ""
  @Field var status: String = ""
  @Field var paused: Boolean = false
  @Field var prevRole: String? = null
  @Field var prevText: String? = null
  @Field var text: String = ""
  @Field var pauseLabel: String = ""
}
