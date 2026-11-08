import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowPlayback } from "./modules.mjs";

test("Play under reduced motion never advances on a tick and offers a finite manual sequence", () => {
  const play = FlowPlayback.create({ reduced: true });
  play.start(["first", "second"]);
  assert.equal(play.state().current,"first");
  assert.equal(play.tick(),false);
  assert.equal(play.state().current,"first");
  assert.equal(play.state().manual,true);
  assert.equal(play.next(),true);
  assert.equal(play.state().current,"second");
  assert.equal(play.state().canNext,false);
  assert.equal(play.next(),false);
  play.stop();
  assert.equal(play.state().active,false);
});

test("enabling reduced motion stops auto-advance immediately, and disabling it does not restart a manual visit", () => {
  const play=FlowPlayback.create();
  play.start(["first","second","third"]);
  assert.equal(play.tick(),true);
  assert.equal(play.state().current,"second");
  play.setReducedMotion(true);
  assert.equal(play.tick(),false);
  assert.equal(play.state().current,"second");
  play.setReducedMotion(false);
  assert.equal(play.tick(),false);
  assert.equal(play.next(),true);
  play.start(["first","second"]);
  assert.equal(play.tick(),true);
  assert.equal(play.tick(),false);
  play.stop();
  assert.equal(play.tick(),false);
  play.start([]);
  assert.equal(play.state().active,false);
});
