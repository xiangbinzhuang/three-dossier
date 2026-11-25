/**
 * 主循环：把「推进状态」和「画一帧」彻底分开。
 *
 * 这个分界不是洁癖，是**可录制**的前提：录制器用固定 dt = 1/30 驱动
 * `advance()`，就能得到和页面上逐帧完全一致的动画。如果渲染和推进揉在一起，
 * 录出来的运镜曲线跟肉眼看到的就不是同一个东西。
 */
export function createLoop({ stage, orbit, explode, callouts, hud, clock, runtime, onTick }) {
  const { renderer, scene, spin, camera } = stage;
  const DUR = clock.duration;
  const OMEGA = clock.omega;
  const TAU = Math.PI * 2;

  function renderFrame() {
    spin.rotation.y = runtime.spinA;
    orbit.apply();
    scene.updateMatrixWorld(true);
    callouts.update(runtime.labels);
    hud.setTime(runtime.t, DUR);
    renderer.render(scene, camera);
  }

  function advance(dt) {
    if (runtime.playing) {
      runtime.t = (runtime.t + dt) % DUR;
      if (runtime.orbit) runtime.spinA = (runtime.spinA + dt * OMEGA) % TAU;
    }
    explode.update(dt);
    onTick?.(dt);
    orbit.update(dt);
  }

  let last = 0, raf = 0, running = false;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    advance(dt);
    renderFrame();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame((n) => { last = n; frame(n); });
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  /** 拖时间轴：把时间与转台角一起贴到位，然后立刻画一帧。 */
  function seek(t) {
    runtime.t = Math.max(0, Math.min(t, DUR));
    runtime.spinA = (runtime.t * OMEGA) % TAU;
    renderFrame();
  }

  return { advance, renderFrame, start, stop, seek, DUR, OMEGA };
}
