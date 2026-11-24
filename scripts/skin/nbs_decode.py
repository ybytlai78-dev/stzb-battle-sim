"""把《率土之滨》客户端里的 .nbs 动画解成 mp4。

原理：.nbs 是「8 字节周期 XOR + VP9 帧链」的私有容器。客户端自己带 libvpx，
所以这里 attach 到正在运行的游戏进程，借它的 vpx 解码器逐帧解，避免自编译。

前置（一次性）：
    adb shell "nohup /data/local/tmp/frida-server -D >/dev/null 2>&1 &"
    adb forward tcp:27042 tcp:27042
    adb shell pidof com.netease.stzb.netease     # 拿到 pid
游戏必须处于运行状态（attach 不打断它，也不 spawn 新进程）。

用法：
    python scripts/skin/nbs_decode.py <pid> <out_dir> <rel_path> [rel_path ...]
    rel_path 相对 mini_client_res/，例如 card/card_2d_videos/big_100035_1.nbs

产出 <out_dir>/<name>.mp4（30fps / libx264 / crf18）+ <out_dir>/_stats.json
"""
import frida
import json
import os
import subprocess
import sys
import time

DEV = '127.0.0.1:27042'
DOC = '/sdcard/Android/data/com.netease.stzb.netease/files/netease/stzb/Documents/mini_client_res/'
FF = os.environ.get('FFMPEG') or 'ffmpeg'

if len(sys.argv) < 4:
    sys.exit(__doc__)

PID = int(sys.argv[1])
OUT = os.path.abspath(sys.argv[2])
TMP = os.path.join(OUT, '_yuv')
RELS = sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

JS = r"""
var PATHS = __P__, done = false;
function findHdr(dv, size){
  function ok(h){
    var p = h, n = 0;
    while (p + 8 <= size){
      var ln = dv.getUint32(p, true), t = dv.getUint32(p + 4, true);
      if (ln < 4 || ln > size) return 0;
      if (t !== 0x42834932 && t !== 0x92400036 && t !== 0x92c00036) return 0;
      p += 4 + ln; n++;
      if (size - p < 16384) return n;
    }
    return 0;
  }
  var h = dv.getUint32(0x24, true);
  if (h >= 64 && h <= 512){ var r = ok(h); if (r) return [h, r]; }
  for (var x = 64; x < 512; x++){ var r2 = ok(x); if (r2) return [x, r2]; }
  return [0, 0];
}
function run(){
  if (done) return;
  var m = Process.findModuleByName('libclient.so'); if (!m) return;
  done = true;
  try {
    function readSafe(p, n){
      var out = new Uint8Array(n), CH = 8192;
      for (var o = 0; o < n; o += CH){
        var len = Math.min(CH, n - o);
        out.set(new Uint8Array(p.add(o).readByteArray(len)), o);
      }
      return out;
    }
    var b = m.base;
    var iface = new NativeFunction(b.add(0x3f836f0), 'pointer', [])();
    var decInit = new NativeFunction(b.add(0x419e780), 'int', ['pointer','pointer','pointer','uint','int']);
    var decode = new NativeFunction(b.add(0x419e920), 'int', ['pointer','pointer','ulong','pointer','long']);
    var getFrame = new NativeFunction(b.add(0x419e970), 'pointer', ['pointer','pointer']);
    for (var fi = 0; fi < PATHS.length; fi++){
      var P = PATHS[fi], name = P.split('/').pop();
      try {
        var f = new File(P, 'rb'); var all = new Uint8Array(f.readBytes(60000000)); f.close();
        if (!(all[0] === 3 && all[1] === 4)){
          var K = [0x8e,0x50,0x9f,0xe8,0x59,0x67,0x91,0xfb];
          for (var i = 0; i < all.length; i++) all[i] ^= K[i & 7];
        }
        var dv = new DataView(all.buffer);
        var hd = findHdr(dv, all.length), off = hd[0], NF = hd[1];
        if (!off || !NF){ send({ev:'skip', name:name, why:'hdr not found'}); continue; }
        send({ev:'file', name:name, hdr:off, frames:NF, bytes:all.length});
        var ctx = Memory.alloc(4096); for (var i2 = 0; i2 < 4096; i2++) ctx.add(i2).writeU8(0);
        var cfg = Memory.alloc(16); cfg.writeU32(1); cfg.add(4).writeU32(0); cfg.add(8).writeU32(0);
        var rc = decInit(ctx, iface, cfg, 0, 0xc);
        if (rc !== 0){ send({ev:'err', name:name, msg:'dec_init ' + rc}); continue; }
        var got = 0;
        for (var k = 0; k < NF; k++){
          var ln = dv.getUint32(off, true);
          if (ln === 0 || off + 4 + ln > all.length) break;
          var buf = Memory.alloc(ln); buf.writeByteArray(all.subarray(off + 4, off + 4 + ln));
          decode(ctx, buf, ln, ptr(0), 0);
          var iter = Memory.alloc(8); iter.writePointer(ptr(0));
          var img = getFrame(ctx, iter); off += 4 + ln;
          if (img.isNull()) continue;
          var dw = img.add(24).readU32(), dh = img.add(28).readU32();
          var sy = img.add(0x50).readS32(), cs = img.add(0x54).readS32();
          var cw = (dw + 1) >> 1, chh = (dh + 1) >> 1;
          var yb = readSafe(img.add(0x30).readPointer(), sy * dh);
          var ub = new Uint8Array(img.add(0x38).readPointer().readByteArray(cs * chh));
          var vb = new Uint8Array(img.add(0x40).readPointer().readByteArray(cs * chh));
          var out = new Uint8Array(dw * dh + 2 * cw * chh), bs = dw * dh;
          for (var r = 0; r < dh; r++) out.set(yb.subarray(r * sy, r * sy + dw), r * dw);
          for (var r2 = 0; r2 < chh; r2++) out.set(ub.subarray(r2 * cs, r2 * cs + cw), bs + r2 * cw);
          bs += cw * chh;
          for (var r3 = 0; r3 < chh; r3++) out.set(vb.subarray(r3 * cs, r3 * cs + cw), bs + r3 * cw);
          send({ev:'frame', name:name, dw:dw, dh:dh}, out.buffer);
          got++;
        }
        send({ev:'file_done', name:name, got:got, total:NF});
      } catch (e) { send({ev:'err', name:name, msg:e.message}); }
    }
    send({ev:'all_done'});
  } catch (e) { send({ev:'fatal', msg:e.message + ' | ' + (e.stack || '')}); }
}
var iv = setInterval(run, 300); setTimeout(function(){ clearInterval(iv); }, 3600000);
""".replace('__P__', json.dumps([DOC + r for r in RELS]))

cur = [None]
fh = [None]
stats = {}
done = [False]


def close_cur():
    if fh[0]:
        try:
            fh[0].close()
        except Exception:
            pass
        fh[0] = None
    if cur[0] and stats.get(cur[0], {}).get('dw'):
        n = cur[0]
        yuv = os.path.join(TMP, n + '.yuv')
        mp4 = os.path.join(OUT, n.replace('.nbs', '.mp4'))
        if os.path.exists(yuv):
            r = subprocess.run([FF, '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p',
                                '-s', '%dx%d' % (stats[n]['dw'], stats[n]['dh']), '-r', '30', '-i', yuv,
                                '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', mp4],
                               capture_output=True)
            if r.returncode == 0:
                os.remove(yuv)
                print('  mp4 -> %s (%.1f MB)' % (os.path.basename(mp4), os.path.getsize(mp4) / 1048576), flush=True)
            else:
                print('  转码失败', n, r.stderr.decode('utf-8', 'ignore')[:200], flush=True)
    cur[0] = None


def on_msg(msg, data):
    if msg['type'] != 'send':
        print('[err]', msg, flush=True)
        return
    p = msg['payload']
    ev = p.get('ev')
    if ev == 'file':
        print('%s  hdr=%d %d 帧 %.2f MB' % (p['name'], p['hdr'], p['frames'], p['bytes'] / 1048576), flush=True)
        stats[p['name']] = {'hdr': p['hdr'], 'frames': p['frames'], 'bytes': p['bytes']}
    elif ev == 'frame' and data:
        n = p['name']
        if cur[0] != n:
            close_cur()
            cur[0] = n
            fh[0] = open(os.path.join(TMP, n + '.yuv'), 'wb')
            stats.setdefault(n, {}).update({'dw': p['dw'], 'dh': p['dh']})
        if fh[0]:
            fh[0].write(data)
    elif ev == 'file_done':
        close_cur()
        stats.setdefault(p['name'], {})['got'] = p['got']
        print('  -> %s %d/%d' % (p['name'], p['got'], p['total']), flush=True)
    elif ev == 'skip':
        print('  跳过', p['name'], p.get('why'), flush=True)
    elif ev == 'all_done':
        done[0] = True
        print('=== 全部完成 ===', flush=True)
    else:
        print(json.dumps(p, ensure_ascii=False)[:400], flush=True)


dev = frida.get_device_manager().add_remote_device(DEV)
print('attach', PID, flush=True)
sess = dev.attach(PID)
sc = sess.create_script(JS)
sc.on('message', on_msg)
sc.load()
t0 = time.time()
while time.time() - t0 < 3600:
    time.sleep(2)
    if done[0]:
        break
close_cur()
json.dump(stats, open(os.path.join(OUT, '_stats.json'), 'w', encoding='utf-8'), indent=1)
print('完成', len(stats), '个文件', flush=True)
