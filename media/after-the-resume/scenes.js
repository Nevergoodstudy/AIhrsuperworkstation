(function () {
  'use strict';

  // Artwork only. The host owns playback, titles, subtitles and transitions.
  // Logical pixels: 1920 x 1080. One beat at 80 BPM is 0.75 seconds.
  var C = { ink: '#071b17', pine: '#173d33', mint: '#b9f4d1',
    paper: '#f1eddc', gold: '#e4c18d', sage: '#8fa99d' };
  var SANS = 'PingFang SC, Microsoft YaHei, sans-serif';
  var SERIF = 'Songti SC, Noto Serif SC, serif';
  var TAU = Math.PI * 2;
  var BEAT = 0.75;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function ease(p) { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); }
  function at(t, start, duration) { return ease((t - start) / duration); }
  function wave(t, period, offset) { return Math.sin(TAU * t / period + (offset || 0)); }
  function text(ctx, value, x, y, size, color, align, serif, weight) {
    ctx.save();
    ctx.font = (weight || '400') + ' ' + Math.max(30, size || 32) + 'px ' + (serif ? SERIF : SANS);
    ctx.fillStyle = color || C.paper; ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic'; ctx.fillText(value, x, y); ctx.restore();
  }
  function tracked(ctx, value, cx, y, size, spacing, color) {
    ctx.save(); ctx.font = '400 ' + Math.max(30, size) + 'px ' + SANS;
    var letters = Array.from(value);
    var widths = letters.map(function (s) { return ctx.measureText(s).width; });
    var width = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (letters.length - 1);
    var x = cx - width / 2;
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    letters.forEach(function (s, i) { ctx.fillText(s, x, y); x += widths[i] + spacing; });
    ctx.restore();
  }
  function line(ctx, x1, y1, x2, y2, color, width, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function roundedPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  function box(ctx, x, y, w, h, fill, stroke, radius) {
    ctx.save(); roundedPath(ctx, x, y, w, h, radius || 0);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
  }
  function circle(ctx, x, y, r, fill, stroke, width) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 2; ctx.stroke(); }
    ctx.restore();
  }
  function glow(ctx, x, y, r, color, opacity) {
    ctx.save(); ctx.globalAlpha *= opacity;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(7,27,23,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function demo(ctx) { text(ctx, '流程示意', 1800, 320, 30, C.sage, 'right'); }
  function paper(ctx, x, y, w, h, fold) {
    var f = clamp(fold === undefined ? 24 : fold, 0, Math.min(w, h) / 3);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.26)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 15;
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, C.paper); g.addColorStop(1, '#d8dbc7'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w - f, y);
    ctx.lineTo(x + w, y + f); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(241,237,220,0.35)';
    ctx.lineWidth = 1; ctx.stroke();
    // A separate fold path keeps the paper texture clipped to the full sheet.
    ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.045;
    for (var i = 0; i < 17; i++) {
      line(ctx, x + 12, y + 18 + i * h / 17, x + w - 12, y + 17 + i * h / 17, C.pine, 1);
    }
    ctx.restore();
    if (f > 0) {
      ctx.beginPath(); ctx.moveTo(x + w - f, y); ctx.lineTo(x + w - f, y + f);
      ctx.lineTo(x + w, y + f); ctx.closePath(); ctx.fillStyle = '#b2c4ad'; ctx.fill();
    }
    ctx.restore();
  }
  function check(ctx, x, y, s, color, progress) {
    var p = clamp(progress === undefined ? 1 : progress, 0, 1);
    ctx.save(); ctx.strokeStyle = color || C.mint; ctx.lineWidth = 4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x, y);
    var first = clamp(p * 2.6, 0, 1);
    ctx.lineTo(x + s * 0.34 * first, y + s * 0.32 * first);
    if (p > 1 / 2.6) {
      var second = clamp((p - 1 / 2.6) / (1 - 1 / 2.6), 0, 1);
      ctx.lineTo(x + s * 0.34 + s * 0.66 * second, y + s * 0.32 - s * 0.92 * second);
    }
    ctx.stroke(); ctx.restore();
  }
  function person(ctx, x, y, scale, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    circle(ctx, 0, -24, 20, null, color, 3);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-37, 37); ctx.bezierCurveTo(-36, -8, 36, -8, 37, 37);
    ctx.stroke(); ctx.restore();
  }
  function lock(ctx, x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 48, size / 48);
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -8, 13, Math.PI, 0); ctx.stroke();
    box(ctx, -22, -8, 44, 36, C.pine, color, 4);
    circle(ctx, 0, 6, 3, color); line(ctx, 0, 9, 0, 17, color, 3); ctx.restore();
  }
  function folder(ctx, x, y, w, h, color) {
    ctx.save(); ctx.beginPath(); ctx.moveTo(x, y + 13); ctx.lineTo(x, y);
    ctx.lineTo(x + w * 0.37, y); ctx.lineTo(x + w * 0.46, y + 13);
    ctx.lineTo(x + w, y + 13); ctx.lineTo(x + w - 5, y + h);
    ctx.lineTo(x + 5, y + h); ctx.closePath(); ctx.fillStyle = C.pine; ctx.fill();
    ctx.strokeStyle = color || C.mint; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  function cubic(points, p) {
    var q = 1 - p;
    return {
      x: q * q * q * points[0] + 3 * q * q * p * points[2] + 3 * q * p * p * points[4] + p * p * p * points[6],
      y: q * q * q * points[1] + 3 * q * q * p * points[3] + 3 * q * p * p * points[5] + p * p * p * points[7]
    };
  }
  function curve(ctx, pts, progress, color, time, width, arrow) {
    var p = clamp(progress, 0, 1);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.globalAlpha *= 0.17;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); ctx.stroke();
    ctx.globalAlpha /= 0.17;
    if (p > 0) {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (var i = 1; i <= 48; i++) { var a = cubic(pts, p * i / 48); ctx.lineTo(a.x, a.y); }
      ctx.stroke();
      if (time !== undefined && p > 0.98) {
        var f = ((time / (BEAT * 4)) % 1 + 1) % 1;
        var dot = cubic(pts, f); circle(ctx, dot.x, dot.y, 4, color);
      }
      if (arrow && p > 0.98) {
        var end = cubic(pts, 1); var prev = cubic(pts, 0.96);
        ctx.translate(end.x, end.y); ctx.rotate(Math.atan2(end.y - prev.y, end.x - prev.x));
        ctx.beginPath(); ctx.moveTo(-11, -6); ctx.lineTo(0, 0); ctx.lineTo(-11, 6); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function reveal(ctx, p, fn) {
    if (p <= 0) return;
    ctx.save(); ctx.globalAlpha *= clamp(p, 0, 1); fn(); ctx.restore();
  }
  function rule(ctx, x, y, w, color, ticks) {
    line(ctx, x, y, x + w, y, color, 2, 0.55);
    for (var i = 0; i <= ticks; i++) {
      line(ctx, x + w * i / ticks, y, x + w * i / ticks, y + (i % 5 === 0 ? 18 : 8), color, 1.5, 0.6);
    }
  }

  // 0: A physical resume is visible on frame zero; questions unfold to its right.
  function resumeScene(ctx, t) {
    glow(ctx, 500, 545, 390, C.gold, 0.095);
    glow(ctx, 1410, 540, 410, C.mint, 0.055);
    var unfold = at(t, 0.75, 2.25);
    ctx.save(); ctx.translate(445, 555); ctx.rotate(-0.065 + 0.018 * at(t, 0, 3));
    paper(ctx, -232, -202, 444, 428, 38 - 18 * unfold);
    line(ctx, -188, -118, 151, -118, C.pine, 1.5, 0.4);
    text(ctx, '简历', -188, -143, 49, C.ink, 'left', true);
    text(ctx, '经历的纸面线索', -188, -65, 30, C.pine);
    ['项目经历', '任职记录', '专业背景'].forEach(function (label, i) {
      var y = -3 + i * 65; circle(ctx, -178, y - 10, 5, C.pine);
      text(ctx, label, -157, y, 32, C.ink);
      line(ctx, 0, y - 10, 157 - i * 22, y - 10, C.pine, 4, 0.18);
    });
    line(ctx, -188, 184, 153, 184, C.pine, 1, 0.25); ctx.restore();
    var questions = [
      { y: 408, label: '如何拆解问题？', end: 1420 },
      { y: 549, label: '为何这样取舍？', end: 1670 },
      { y: 690, label: '能否说明依据？', end: 1490 }
    ];
    questions.forEach(function (q, i) {
      var p = at(t, 1.5 + i * 1.5, 1.5);
      curve(ctx, [650, 449 + i * 94, 796, 449 + i * 94, 805, q.y, 940, q.y], p, C.sage, t + i, 2);
      reveal(ctx, p, function () {
        ctx.save(); ctx.translate(943, q.y - 45); ctx.scale(lerp(0.06, 1, p), 1);
        box(ctx, 0, 0, q.end - 940, 89, C.pine, i === 1 ? C.gold : C.sage, 2);
        ctx.fillStyle = i === 1 ? C.gold : C.mint; ctx.fillRect(0, 0, 5, 89);
        text(ctx, q.label, 31, 58, 40, C.paper); ctx.restore();
      });
    });
    reveal(ctx, at(t, 6.75, 1.5), function () {
      text(ctx, '纸上的经历，留下待验证的问题。', 963, 800, 32, C.sage);
    });
    demo(ctx);
  }

  // 1: Experience is a description; evidence has to be produced in a task.
  function distinctionScene(ctx, t) {
    glow(ctx, 1415, 545, 410, C.mint, 0.07);
    text(ctx, '经历描述', 164, 359, 34, C.sage);
    ctx.save(); ctx.translate(427, 555); ctx.rotate(-0.035);
    paper(ctx, -270, -153, 540, 312, 21);
    text(ctx, '“参与过项目”', -231, -75, 42, C.ink, 'left', true);
    text(ctx, '“负责过协作”', -231, 1, 42, C.ink, 'left', true);
    text(ctx, '“有相关经验”', -231, 77, 42, C.ink, 'left', true); ctx.restore();
    line(ctx, 760, 419, 760, 709, C.sage, 1, 0.25);
    line(ctx, 1005, 419, 1005, 709, C.sage, 1, 0.25);
    text(ctx, '≠', 882, 607, 116, C.gold, 'center', true);
    text(ctx, '任务证据', 1108, 359, 34, C.mint);
    [['拆出问题与约束', '拆解'], ['比较路径与代价', '取舍'], ['说明结论与依据', '表达']].forEach(function (row, i) {
      var p = at(t, 1.5 + i * 1.5, 1.5); var y = 405 + i * 108;
      ctx.save(); ctx.translate(1090, y); ctx.scale(lerp(0.07, 1, p), 1);
      paper(ctx, 0, 0, 665, 87, 16 + (1 - p) * 24);
      text(ctx, row[0], 30, 56, 36, C.ink);
      line(ctx, 464, 19, 464, 67, C.pine, 1, 0.28);
      text(ctx, row[1], 558, 56, 32, C.pine, 'center'); ctx.restore();
      reveal(ctx, p, function () { check(ctx, 1054, y + 39, 20, C.mint); });
    });
    reveal(ctx, at(t, 0.75, 2.25), function () {
      text(ctx, '提供线索', 427, 788, 32, C.sage, 'center');
      text(ctx, '产生可观察的作答', 1420, 788, 32, C.mint, 'center');
      curve(ctx, [569, 777, 747, 777, 1027, 777, 1200, 777], at(t, 6, 1.5), C.gold, undefined, 2, true);
    });
    demo(ctx);
  }

  // 2: One calibrated drafting surface and three observation dimensions.
  function rubricScene(ctx, t) {
    glow(ctx, 950, 555, 620, C.mint, 0.045); rule(ctx, 144, 567, 1628, C.sage, 60);
    [150, 720, 1290].forEach(function (x, i) {
      var p = at(t, 0.75 + i * 1.5, 1.5);
      if (i > 0) line(ctx, x - 45, 346, x - 45, 757, C.sage, 1, 0.2);
      reveal(ctx, Math.max(0.2, p), function () {
        if (i === 0) {
          paper(ctx, x + 21, 359, 152, 145, 17);
          line(ctx, x + 46, 398, x + 132, 398, C.pine, 3, 0.45);
          line(ctx, x + 46, 427, x + 116, 427, C.pine, 3, 0.3);
          ['约束', '假设', '行动'].forEach(function (label, j) {
            var yy = 360 + j * 66; var xx = x + 257 + 12 * p;
            curve(ctx, [x + 174, 428, x + 213, 428, x + 217, yy + 21, xx, yy + 21], p, C.mint, undefined, 2);
            box(ctx, xx, yy, 158, 45, C.pine, C.sage, 2);
            text(ctx, label, xx + 79, yy + 33, 30, C.paper, 'center');
          });
        } else if (i === 1) {
          var tilt = -0.12 * (1 - p) + 0.018 * wave(Math.min(t, 6), BEAT * 8);
          var cx = x + 225;
          line(ctx, cx, 413, cx, 531, C.sage, 3); line(ctx, cx - 64, 533, cx + 64, 533, C.sage, 3);
          ctx.save(); ctx.translate(cx, 410); ctx.rotate(tilt); line(ctx, -178, 0, 178, 0, C.gold, 4);
          [-1, 1].forEach(function (side) {
            var sx = side * 143; line(ctx, sx, 0, sx - 49, 75, C.sage, 2); line(ctx, sx, 0, sx + 49, 75, C.sage, 2);
            ctx.beginPath(); ctx.moveTo(sx - 58, 75); ctx.quadraticCurveTo(sx, 112, sx + 58, 75);
            ctx.strokeStyle = C.mint; ctx.lineWidth = 3; ctx.stroke();
          }); ctx.restore();
          text(ctx, '路径甲', x + 82, 361, 30, C.paper, 'center');
          text(ctx, '路径乙', x + 367, 361, 30, C.paper, 'center'); circle(ctx, cx, 410, 8, C.gold);
        } else {
          paper(ctx, x + 23, 361, 376, 89, 15);
          text(ctx, '结论', x + 211, 418, 36, C.ink, 'center');
          curve(ctx, [x + 211, 453, x + 211, 480, x + 104, 473, x + 104, 495], p, C.mint, undefined, 2);
          curve(ctx, [x + 211, 453, x + 211, 480, x + 319, 473, x + 319, 495], p, C.mint, undefined, 2);
          text(ctx, '依据', x + 104, 532, 32, C.mint, 'center'); text(ctx, '说明', x + 319, 532, 32, C.mint, 'center');
        }
        var titles = ['拆解问题', '方案取舍', '表达说明'];
        var a = ['是否识别关键约束', '是否比较可选路径', '是否清楚组织结论'];
        var b = ['是否给出可执行步骤', '是否说明选择与代价', '是否给出支撑依据'];
        text(ctx, titles[i], x + 8, 644, 43, C.paper, 'left', true);
        circle(ctx, x + 17, 690, 4, C.gold); text(ctx, a[i], x + 37, 701, 30, C.sage);
        circle(ctx, x + 17, 742, 4, C.gold); text(ctx, b[i], x + 37, 753, 30, C.sage);
      });
    });
    reveal(ctx, at(t, 6, 1.5), function () {
      text(ctx, '人工评分要点：先约定观察什么，再阅读作答。', 150, 813, 31, C.gold);
    }); demo(ctx);
  }

  // 3: All answers are neutral placeholders, never real candidate information.
  function responseScene(ctx, t) {
    var unfold = at(t, 1.5, 2.25); glow(ctx, 997, 542, 460, C.gold, 0.055);
    text(ctx, '专属邀请', 287, 373, 35, C.paper, 'center');
    ctx.save(); ctx.translate(285, 529); ctx.rotate(-0.035);
    box(ctx, -150, -80, 300, 191, C.pine, C.sage, 2);
    var flap = lerp(57, -68, at(t, 0.75, 1.5));
    ctx.beginPath(); ctx.moveTo(-150, -80); ctx.lineTo(0, -80 + flap); ctx.lineTo(150, -80);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
    paper(ctx, -111, -100 - 30 * unfold, 222, 150, 15);
    text(ctx, '任务邀请', 0, -43 - 30 * unfold, 32, C.ink, 'center');
    line(ctx, -73, -16 - 30 * unfold, 73, -16 - 30 * unfold, C.pine, 3, 0.25);
    ctx.beginPath(); ctx.moveTo(-150, -80); ctx.lineTo(0, 23); ctx.lineTo(150, -80);
    ctx.lineTo(150, 111); ctx.lineTo(-150, 111); ctx.closePath();
    ctx.fillStyle = C.pine; ctx.fill(); ctx.strokeStyle = C.sage; ctx.stroke(); ctx.restore();
    text(ctx, '仅展示占位内容', 287, 714, 30, C.sage, 'center');
    curve(ctx, [449, 538, 510, 538, 551, 538, 618, 538], at(t, 0.75, 1.5), C.gold, t, 2, true);
    ctx.save(); ctx.translate(635, 344); ctx.scale(lerp(0.76, 1, unfold), 1);
    paper(ctx, 0, 0, 752, 428, lerp(68, 25, unfold));
    text(ctx, '候选人任务作答', 34, 56, 39, C.ink, 'left', true);
    text(ctx, '请说明问题、取舍与下一步。', 34, 110, 32, C.pine);
    line(ctx, 34, 137, 710, 137, C.pine, 1, 0.3);
    var a = '先列出约束，再比较两种路径。'; var b = '说明选择依据，并列出下一步。';
    var count = Math.floor((a.length + b.length) * at(t, 3, 3));
    text(ctx, a.slice(0, Math.min(a.length, count)), 34, 202, 34, C.ink);
    text(ctx, b.slice(0, Math.max(0, count - a.length)), 34, 267, 34, C.ink);
    if (t >= 3 && t < 7.5 && wave(t, BEAT) > -0.2) {
      ctx.save(); ctx.font = '400 34px ' + SANS;
      var current = count <= a.length ? a.slice(0, count) : b.slice(0, count - a.length);
      var caret = 34 + ctx.measureText(current).width;
      line(ctx, caret + 5, count <= a.length ? 173 : 238, caret + 5, count <= a.length ? 208 : 273, C.pine, 2); ctx.restore();
    }
    text(ctx, '示例文字 · 不含真实信息', 34, 329, 30, C.pine);
    line(ctx, 34, 350, 710, 350, C.pine, 1, 0.25);
    text(ctx, t < 8.25 ? '作答内容可保存' : '作答已提交（示意）', 34, 394, 31, C.pine);
    if (t >= 8.25) check(ctx, 671, 382, 24, C.pine, at(t, 8.25, 0.75)); ctx.restore();
    var states = ['接受任务', '保存作答', '提交复核']; var times = [0.75, 5.25, 8.25];
    line(ctx, 1483, 408, 1483, 692, C.sage, 2, 0.3);
    states.forEach(function (label, i) {
      var q = at(t, times[i], 0.75); var y = 417 + 132 * i;
      circle(ctx, 1483, y, 20, C.ink, q > 0 ? C.mint : C.sage, 2);
      if (q > 0) check(ctx, 1473, y - 1, 20, C.mint, q);
      text(ctx, label, 1525, y + 12, 33, q > 0 ? C.paper : C.sage);
    }); demo(ctx);
  }

  // 4: Quotes remain connected to the source. AI never occupies judgment.
  function evidenceScene(ctx, t) {
    glow(ctx, 955, 559, 350, C.mint, 0.065); paper(ctx, 140, 348, 558, 407, 27);
    text(ctx, '候选人答卷原文', 173, 407, 38, C.ink, 'left', true);
    line(ctx, 173, 434, 658, 434, C.pine, 1, 0.25);
    ['先列出约束，', '再比较两种路径。', '说明选择的依据。'].forEach(function (s, i) {
      var y = 488 + i * 79; var p = at(t, 0.75 + i * 0.75, 1.5);
      ctx.save(); ctx.globalAlpha *= p * 0.7; ctx.fillStyle = '#c1d4af';
      ctx.fillRect(167, y - 35, 457 * p, 48); ctx.restore();
      text(ctx, s, 179, y, 34, C.ink); circle(ctx, 655, y - 11, 6, C.pine);
      curve(ctx, [699, y - 11, 757, y - 11, 764, 548, 814, 548], p, i === 1 ? C.gold : C.mint, undefined, 2);
    }); text(ctx, '示例摘录', 173, 715, 30, C.pine);
    var gather = at(t, 3, 1.5);
    ctx.save(); ctx.translate(942, 540);
    [-1, 0, 1].forEach(function (i) {
      ctx.save(); ctx.rotate(i * 0.09 * (1 - gather));
      box(ctx, -110 + i * 13 * (1 - gather), -66 + i * 10, 220, 126, C.pine, i === 0 ? C.mint : C.sage, 3); ctx.restore();
    });
    text(ctx, '整理摘录', 0, 0, 34, C.paper, 'center'); text(ctx, '关联原文', 0, 44, 30, C.mint, 'center'); ctx.restore();
    text(ctx, '可选 AI · 整理线索', 942, 705, 30, C.mint, 'center');
    curve(ctx, [1060, 538, 1095, 538, 1126, 538, 1170, 538], at(t, 4.5, 1.5), C.gold, t, 2.5, true);
    box(ctx, 1201, 348, 553, 407, null, C.sage, 3); person(ctx, 1265, 414, 0.65, C.gold);
    text(ctx, '人工判断', 1325, 417, 43, C.paper, 'left', true);
    line(ctx, 1233, 452, 1722, 452, C.sage, 1, 0.3);
    ['核对原文出处', '结合岗位要求', '保留复核意见'].forEach(function (s, i) {
      var p = at(t, 5.25 + i * 0.75, 0.75); var y = 516 + i * 80;
      circle(ctx, 1251, y - 10, 15, null, C.sage, 2);
      reveal(ctx, p, function () { check(ctx, 1242, y - 10, 18, C.gold); });
      text(ctx, s, 1292, y, 33, C.paper);
    });
    reveal(ctx, at(t, 7.5, 1.5), function () {
      text(ctx, '每条摘录可回到原文，每个结论由人复核。', 944, 808, 32, C.sage, 'center');
    }); demo(ctx);
  }

  // 5: Two independent review lanes merge before HR publishes feedback.
  function reviewScene(ctx, t) {
    glow(ctx, 1077, 548, 600, C.mint, 0.045);
    [438, 670].forEach(function (y, i) {
      var p = at(t, 0.75 + i * 1.5, 1.5);
      circle(ctx, 235, y, 60, C.pine, i === 0 ? C.mint : C.gold, 2);
      person(ctx, 235, y + 2, 0.73, i === 0 ? C.mint : C.gold);
      text(ctx, '复核人 ' + (i === 0 ? 'A' : 'B'), 235, y - 82, 32, C.paper, 'center');
      curve(ctx, [300, y, 326, y, 347, y, 380, y], p, C.sage, undefined, 2);
      ctx.save(); ctx.translate(392, y - 82); ctx.rotate(i === 0 ? -0.012 : 0.012);
      paper(ctx, 0, 0, 419, 166, 20); text(ctx, '独立复核意见', 28, 48, 34, C.ink);
      line(ctx, 28, 68, 381, 68, C.pine, 1, 0.24);
      reveal(ctx, p, function () { text(ctx, i === 0 ? '证据摘录与依据' : '待核对事项与说明', 28, 122, 30, C.pine); }); ctx.restore();
      curve(ctx, [820, y, 934, y, 932, 548, 1052, 548], at(t, 3.75 + i * 0.75, 1.5), i === 0 ? C.mint : C.gold, t + i * BEAT, 2.5);
    });
    text(ctx, '共同复核', 1068, 365, 36, C.paper, 'center');
    circle(ctx, 1068, 548, 17, C.pine, C.mint, 2);
    reveal(ctx, at(t, 5.25, 0.75), function () { circle(ctx, 1068, 548, 5, C.gold); });
    curve(ctx, [1086, 548, 1126, 548, 1170, 548, 1211, 548], at(t, 5.25, 1.5), C.mint, t, 2.5, true);
    circle(ctx, 1280, 548, 65, C.pine, C.gold, 2); person(ctx, 1280, 545, 0.82, C.gold);
    text(ctx, 'HR', 1280, 668, 36, C.paper, 'center'); text(ctx, '发布反馈', 1280, 718, 31, C.sage, 'center');
    curve(ctx, [1349, 548, 1391, 548, 1425, 548, 1465, 548], at(t, 6.75, 1.5), C.gold, t, 2.5, true);
    var p = at(t, 7.5, 1.5); ctx.save(); ctx.translate(1483, 381);
    paper(ctx, 0, 0, 292, 335, lerp(41, 23, p)); text(ctx, '反馈', 30, 60, 40, C.ink, 'left', true);
    line(ctx, 30, 87, 254, 87, C.pine, 1, 0.25);
    ['复核结果', '说明与建议'].forEach(function (s, i) {
      reveal(ctx, p, function () { text(ctx, s, 30, 150 + i * 66, 32, C.pine); });
    });
    if (p > 0) check(ctx, 213, 277, 32, C.pine, p); ctx.restore();
    text(ctx, '候选人接收', 1629, 774, 32, C.sage, 'center'); demo(ctx);
  }

  // 6: Role boundaries and reversible recovery, without fabricated records.
  function trustScene(ctx, t) {
    text(ctx, '按角色授权', 143, 350, 36, C.paper, 'left', true);
    text(ctx, '备份与恢复', 1370, 350, 36, C.paper, 'left', true);
    line(ctx, 1260, 366, 1260, 727, C.sage, 1, 0.32);
    var roles = ['HR', '部门', '候选人']; var scopes = ['招聘协作', '岗位复核', '本人任务'];
    [299, 670, 1041].forEach(function (x, i) {
      var p = at(t, 0.75 + i * 0.75, 1.5); var col = i === 1 ? C.gold : C.mint;
      ctx.save(); ctx.setLineDash([6, 11]); ctx.lineDashOffset = -Math.min(t, 5.25) * 5;
      roundedPath(ctx, x - 153, 382, 306, 321, 118);
      ctx.strokeStyle = C.sage; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.4 + p * 0.4; ctx.stroke(); ctx.restore();
      person(ctx, x, 443, 0.62, col); text(ctx, roles[i], x, 519, 36, C.paper, 'center');
      line(ctx, x - 95, 542, x + 95, 542, C.sage, 1, 0.3); lock(ctx, x - 89, 591, 30, col);
      text(ctx, scopes[i], x - 53, 604, 31, C.paper); text(ctx, '授权范围', x, 667, 30, C.sage, 'center');
      reveal(ctx, p, function () { line(ctx, x - 69, 688, x + 69, 688, col, 2); });
    });
    var recover = at(t, 6, 2.25); var lift = Math.sin(recover * Math.PI) * 35;
    glow(ctx, 1570, 544, 250, C.gold, 0.065); folder(ctx, 1405, 438, 322, 225, C.sage);
    for (var j = 2; j >= 0; j--) {
      ctx.save(); ctx.translate(1430 + j * 13, 423 + j * 22 - (j === 0 ? lift : 0));
      paper(ctx, 0, 0, 244, 160, 15);
      line(ctx, 25, 35, 200, 35, C.pine, 3, 0.32); line(ctx, 25, 65, 164, 65, C.pine, 3, 0.22);
      if (j === 0) text(ctx, '备份副本', 24, 123, 31, C.pine); ctx.restore();
    }
    box(ctx, 1396, 573, 341, 96, C.pine, C.sage, 2);
    text(ctx, '可恢复数据', 1566, 636, 34, C.paper, 'center');
    curve(ctx, [1711, 488, 1806, 420, 1793, 713, 1675, 704], at(t, 4.5, 1.5), C.gold, undefined, 2.5, true);
    reveal(ctx, recover, function () {
      circle(ctx, 1414, 706, 19, C.pine, C.mint, 2); check(ctx, 1404, 705, 20, C.mint, recover);
      text(ctx, '恢复至可用状态', 1445, 719, 30, C.mint);
    });
    line(ctx, 149, 771, 1759, 771, C.sage, 1, 0.34); text(ctx, '操作留痕', 153, 815, 31, C.sage);
    [348, 541, 734, 927, 1120, 1313, 1506, 1699].forEach(function (x, i) {
      var p = at(t, 3 + i * 0.18, 0.75); circle(ctx, x, 771, i % 3 === 0 ? 6 : 4, i % 3 === 0 ? C.gold : C.sage);
      line(ctx, x, 771, x, 790 + (i % 2) * 9, C.sage, 1.5, p * 0.65);
    });
    text(ctx, '审计 · 备份 · 恢复', 1759, 815, 31, C.sage, 'right'); demo(ctx);
  }

  // 7: The complete title lockup settles by 6 seconds and holds to the end.
  function finaleScene(ctx, t) {
    var settled = Math.min(t, 6); var p = at(settled, 0, 3);
    glow(ctx, 960, 433, 690, C.mint, 0.065); glow(ctx, 960, 416, 280, C.gold, 0.035);
    ctx.save(); ctx.globalAlpha *= 0.16;
    [0, 1, 2].forEach(function (i) {
      curve(ctx, [124, 648 - i * 93, 407, 247 - i * 14, 1454, 248 - i * 14, 1795, 647 - i * 93], 1, i === 1 ? C.gold : C.sage, undefined, 1);
    }); ctx.restore();
    var labels = ['岗位', '简历', '测评', '人工复核', '反馈']; var xs = [390, 675, 960, 1245, 1530];
    labels.forEach(function (label, i) {
      var q = at(settled, i * 0.375, 1.5);
      if (i < 4) curve(ctx, [xs[i] + 21, 210, xs[i] + 99, 178, xs[i] + 185, 178, xs[i + 1] - 21, 210], at(settled, 0.375 + i * 0.375, 1.5), C.sage, undefined, 1.5);
      reveal(ctx, 0.25 + q * 0.75, function () {
        ctx.save(); ctx.translate(xs[i], 210); ctx.rotate((1 - q) * (i - 2) * 0.1);
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(13, 0); ctx.lineTo(0, 15);
        ctx.lineTo(-13, 0); ctx.closePath(); ctx.fillStyle = i === 3 ? C.gold : C.mint; ctx.fill(); ctx.restore();
        text(ctx, label, xs[i], 277, 32, C.sage, 'center');
      });
    });
    ctx.save(); ctx.translate(960, 115); ctx.rotate(-0.08 * (1 - p));
    ctx.beginPath(); ctx.moveTo(-30, -25); ctx.lineTo(8, -25); ctx.lineTo(30, -3);
    ctx.lineTo(30, 29); ctx.lineTo(-30, 29); ctx.closePath(); ctx.fillStyle = C.paper; ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -25); ctx.lineTo(8, -3); ctx.lineTo(30, -3); ctx.closePath(); ctx.fillStyle = C.gold; ctx.fill();
    line(ctx, -16, 5, 12, 5, C.pine, 2); line(ctx, -16, 16, 4, 16, C.pine, 2); ctx.restore();
    ctx.save(); ctx.translate(960, lerp(478, 462, p)); ctx.scale(lerp(0.95, 1, p), 1);
    ctx.globalAlpha *= lerp(0.45, 1, at(t, 0, 1.5));
    ctx.shadowColor = 'rgba(185,244,209,0.09)'; ctx.shadowBlur = 30;
    text(ctx, '简历之后', 0, 0, 172, C.paper, 'center', true); ctx.restore();
    reveal(ctx, at(t, 0.75, 1.5), function () { tracked(ctx, 'BEYOND THE RESUME', 960, 550, 37, 8, C.mint); });
    var ruleP = at(t, 1.5, 2.25);
    line(ctx, 960 - 365 * ruleP, 599, 960 + 365 * ruleP, 599, C.gold, 1.5, 0.6);
    reveal(ctx, at(t, 2.25, 1.5), function () { text(ctx, 'TalentDesk 招聘工作台', 960, 685, 46, C.paper, 'center'); });
    reveal(ctx, at(t, 3, 1.5), function () { text(ctx, '流程示意 · 正式环境待部署与业务验收', 960, 758, 30, C.sage, 'center'); });
  }

  var scenes = [resumeScene, distinctionScene, rubricScene, responseScene,
    evidenceScene, reviewScene, trustScene, finaleScene];

  function draw(ctx, index, localTime, absoluteTime) {
    ctx.save();
    try {
      // No retained animation state: seeks and reverse scrubbing are exact.
      var i = Number.isFinite(index) ? clamp(Math.floor(index), 0, 7) : 0;
      var t = Number.isFinite(localTime) ? clamp(localTime, 0, 12) : 0;
      var absolute = Number.isFinite(absoluteTime) ? absoluteTime : i * 12 + t;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.beginPath();
      if (i === 7) ctx.rect(0, 0, 1920, 800);
      else ctx.rect(110, 290, 1700, 530);
      ctx.clip(); scenes[i](ctx, t, absolute);
    } finally { ctx.restore(); }
  }

  window.TalentFilmArt = { draw: draw };
}());
