/**
 * 底部仪表：时间轴波形 + 层叠图 + 时间读数。
 *
 * 这三块是「档案页的仪表盘」：波形是示意（不是真实信号），层叠图按产品
 * 提供的层名生成同心的示意剖面。数据全部来自产品配置，kit 只管画。
 */
export function createHud({ cfg, dom }) {
  const H = cfg || {};

  /* ── 时间轴波形：两条不同频率的合成曲线，看着像信号就行 ──────────── */
  function drawLane() {
    const L = H.lane || {};
    const N = L.samples ?? 300, W = L.width ?? 600, base = L.base ?? 18;
    const pts1 = [], pts2 = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = base - (Math.sin(u * 7.1 + 0.4) * 4.2 + Math.sin(u * 17.3) * 1.6 + Math.sin(u * 31.7) * 0.9) - 2;
      const b = base - (Math.sin(u * 4.3 + 2.1) * 3.1 + Math.sin(u * 11.9) * 1.2) - 6;
      pts1.push(`${i ? 'L' : 'M'}${(u * W).toFixed(1)} ${a.toFixed(1)}`);
      pts2.push(`${i ? 'L' : 'M'}${(u * W).toFixed(1)} ${b.toFixed(1)}`);
    }
    dom.waveA?.setAttribute('d', pts1.join(' '));
    dom.waveB?.setAttribute('d', pts2.join(' '));
    if (dom.ticks) {
      let tk = '';
      for (let x = 0; x <= W; x += 50) tk += `M${x} 16 V20 `;
      dom.ticks.setAttribute('d', tk);
    }
  }

  /* ── 层叠图：每一层一个同心圆，外圈实线、内圈虚线（偶数层）───────── */
  function drawStack() {
    const layers = H.layers || [];
    const host = dom.stackRow;
    if (!host) return;
    layers.forEach((name, i) => {
      const r = 13 - i * 0.9;
      const d = document.createElement('div');
      d.className = 'cell';
      d.innerHTML = `<svg viewBox="0 0 30 30">
        <g fill="none" stroke="var(--stack-line, #1b1a18)" stroke-width=".7">
          <circle cx="15" cy="15" r="${r}"/>
          <circle cx="15" cy="15" r="${r - 2.4}" stroke-width=".45" stroke-dasharray="${i % 2 ? '1 1.8' : '0'}"/>
        </g>
      </svg><span>L0${i + 1}</span>`;
      host.appendChild(d);
      d.title = name;
    });
  }

  /* ── 每帧时间读数 ──────────────────────────────────────────────────── */
  function setTime(t, dur) {
    if (dom.timeText) {
      const mm = Math.floor(t).toString().padStart(2, '0');
      const ss = Math.floor((t % 1) * 100).toString().padStart(2, '0');
      dom.timeText.textContent = `00:${mm}.${ss.slice(0, 1)} / 00:${String(dur).padStart(2, '0')}`;
    }
    if (dom.head) {
      /* 进度指针的 x 必须跟波形用同一个宽度常量 —— 波形按 W 画满整个 viewBox，
         指针另写一个数就会跟波形错位。 */
      const W = (H.lane || {}).width ?? 600;
      const px = (t / dur) * W;
      dom.head.setAttribute('d', `M${px} 2 V24`);
      dom.headDot?.setAttribute('cx', px);
    }
  }

  function mount() { drawLane(); drawStack(); }

  return { mount, drawLane, drawStack, setTime };
}
