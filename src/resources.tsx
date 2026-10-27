export function gbFromMib(mib: number): number {
  return Math.round((mib / 1024) * 1000) / 1000;
}

export function mibFromGb(gb: number): number {
  if (!Number.isFinite(gb) || gb <= 0) return 32;
  return Math.max(32, Math.round(gb * 1024));
}

export function fmtGb(mib: number): string {
  const g = mib / 1024;
  if (g < 1) return `${Math.round(mib)} MiB`;
  const rounded = g >= 10 || g % 1 === 0 ? g.toFixed(0) : g.toFixed(1);
  return `${rounded} GB`;
}

export function cpuCores(cpu: number): string {
  const c = cpu / 100;
  return c === 1 ? "1 core" : `${c % 1 === 0 ? c.toFixed(0) : c.toFixed(1)} cores`;
}

const MEM_PRESETS = [0.5, 1, 2, 4, 8, 16, 32];
const CPU_PRESETS = [50, 100, 200, 400, 800];
const DISK_PRESETS = [1, 2, 5, 10, 25, 50, 100];

export function ResourceLimits({
  memoryMib,
  cpu,
  diskMib,
  onChange,
  memoryMaxGb = 64,
  cpuMax = 800,
  diskMaxGb = 500,
}: {
  memoryMib: number;
  cpu: number;
  diskMib: number;
  onChange: (next: { memory: number; cpu: number; disk: number }) => void;
  memoryMaxGb?: number;
  cpuMax?: number;
  diskMaxGb?: number;
}) {
  const gb = gbFromMib(memoryMib);
  const diskGb = gbFromMib(diskMib);

  function setMemGb(v: number) {
    const n = Math.min(memoryMaxGb, Math.max(0.25, v));
    onChange({ memory: mibFromGb(n), cpu, disk: diskMib });
  }
  function setCpu(v: number) {
    const n = Math.min(cpuMax, Math.max(10, Math.round(v)));
    onChange({ memory: memoryMib, cpu: n, disk: diskMib });
  }
  function setDiskGb(v: number) {
    const n = Math.min(diskMaxGb, Math.max(0.25, v));
    onChange({ memory: memoryMib, cpu, disk: mibFromGb(n) });
  }

  return (
    <div className="res-grid full">
      <div className="res-block">
        <div className="res-head">
          <strong>
            <i className="fa-solid fa-memory" aria-hidden /> Memory
          </strong>
          <span className="mono muted">{memoryMib} MiB</span>
        </div>
        <div className="res-chips">
          {MEM_PRESETS.filter((p) => p <= memoryMaxGb).map((p) => (
            <button
              key={p}
              type="button"
              className={`res-chip ${Math.abs(gb - p) < 0.05 ? "on" : ""}`}
              onClick={() => setMemGb(p)}
            >
              {p} GB
            </button>
          ))}
        </div>
        <div className="res-input-row">
          <input
            type="number"
            min={0.25}
            max={memoryMaxGb}
            step={0.25}
            value={Number.isInteger(gb) ? gb : Number(gb.toFixed(2))}
            onChange={(e) => setMemGb(Number(e.target.value))}
          />
          <span>GB</span>
          <input
            type="range"
            min={0.25}
            max={Math.min(memoryMaxGb, 32)}
            step={0.25}
            value={Math.min(gb, 32)}
            onChange={(e) => setMemGb(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="res-block">
        <div className="res-head">
          <strong>
            <i className="fa-solid fa-microchip" aria-hidden /> CPU
          </strong>
          <span className="mono muted">
            {cpu}% · {cpuCores(cpu)}
          </span>
        </div>
        <div className="res-chips">
          {CPU_PRESETS.filter((p) => p <= cpuMax).map((p) => (
            <button
              key={p}
              type="button"
              className={`res-chip ${cpu === p ? "on" : ""}`}
              onClick={() => setCpu(p)}
            >
              {p}% · {cpuCores(p)}
            </button>
          ))}
        </div>
        <div className="res-input-row">
          <input
            type="number"
            min={10}
            max={cpuMax}
            step={10}
            value={cpu}
            onChange={(e) => setCpu(Number(e.target.value))}
          />
          <span>%</span>
          <input type="range" min={10} max={cpuMax} step={10} value={cpu} onChange={(e) => setCpu(Number(e.target.value))} />
        </div>
      </div>

      <div className="res-block">
        <div className="res-head">
          <strong>
            <i className="fa-solid fa-hard-drive" aria-hidden /> Disk
          </strong>
          <span className="mono muted">{diskMib} MiB</span>
        </div>
        <div className="res-chips">
          {DISK_PRESETS.filter((p) => p <= diskMaxGb).map((p) => (
            <button
              key={p}
              type="button"
              className={`res-chip ${Math.abs(diskGb - p) < 0.05 ? "on" : ""}`}
              onClick={() => setDiskGb(p)}
            >
              {p} GB
            </button>
          ))}
        </div>
        <div className="res-input-row">
          <input
            type="number"
            min={0.25}
            max={diskMaxGb}
            step={0.25}
            value={Number.isInteger(diskGb) ? diskGb : Number(diskGb.toFixed(2))}
            onChange={(e) => setDiskGb(Number(e.target.value))}
          />
          <span>GB</span>
          <input
            type="range"
            min={0.25}
            max={Math.min(diskMaxGb, 100)}
            step={0.25}
            value={Math.min(diskGb, 100)}
            onChange={(e) => setDiskGb(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="res-summary">
        <i className="fa-solid fa-sliders" aria-hidden />
        {fmtGb(memoryMib)} RAM · {cpu}% CPU ({cpuCores(cpu)}) · {fmtGb(diskMib)} disk
      </div>
    </div>
  );
}
