"""Pasa el estado de los Reels (estado.json) a la base de datos de la web.

Uso:  python3 scripts/exportar.py scripts/estado.json
Genera:
  public/data.json   pixelitos e islas. La web los lee de ahí: con subir este archivo al repo
                     (git push), Cloudflare publica solo y la web queda al día con el último Reel.

Los colores salen igual que en el video: se usa el mismo sorteo que make_people() de sim.py
(semilla = día × 977), así cada pixelito tiene la misma remera, pelo, piel y pantalón.
"""
import sys, json, random, os

SHIRTS = ['#FF3D3D', '#2F80ED', '#27AE60', '#FF9F1C', '#9B51E0', '#FF4FA3', '#00C2A8', '#FFD23F']
HAIRS = ['#2C2C2A', '#633806', '#BA7517', '#E8C35A', '#412402', '#D9480F']
SKINS = ['#FFD3A5', '#F0A878', '#B97A4B', '#FCE1C8', '#8D5A3B']
PANTS = ['#1F3A93', '#2C2C2A', '#5D4037', '#37474F']
PRE = ['lu', 'mili', 'tano', 'vale', 'nico', 'sofi', 'juan', 'caro', 'pato', 'rodri', 'meli', 'fer', 'gabi', 'santi', 'ali', 'juli', 'mati', 'agus', 'cami', 'lean', 'facu', 'romi', 'pau', 'dani', 'eze', 'flor']
SUF = ['_py', '.ok', '23', '.gamer', '_art', '99', '.x', '10', '_07', '.uwu', '.ph', '_22', '.fit', '_asu', '.mp3']


def looks(day, n):
    """Mismo orden de sorteo que sim.make_people()."""
    rng = random.Random(day * 977)
    used = set(); out = []
    for i in range(n):
        while True:
            nm = '@' + rng.choice(PRE) + rng.choice(SUF)
            if nm not in used: used.add(nm); break
        s, h, k, pa = rng.choice(SHIRTS), rng.choice(HAIRS), rng.choice(SKINS), rng.choice(PANTS)
        rng.random(); rng.choice(['#FF3D7F', '#2F80ED', '#FFE14D', '#27AE60', '#FF9F1C'])
        out.append(dict(s=s, h=h, k=k, pa=pa))
    return out


def people(g):
    for x in g['people']:
        if isinstance(x, str):
            yield (x[1:], True) if x.startswith('!') else (x, False)
        else:
            yield x['n'], bool(x.get('out'))


def main(path):
    st = json.load(open(path))
    rows = []; num = 0
    for g in st['groups']:
        ps = list(people(g))
        if not ps: continue
        for (n, out), lk in zip(ps, looks(g['d'], len(ps))):
            num += 1
            rows.append(dict(num=num, handle=n.lower(), day=g['d'], act=g.get('label') or g['a'], out=1 if out else 0, **lk))
    labels = {g['d']: g.get('label') or g['a'] for g in st['groups']}
    acts = {g['d']: g['a'] for g in st['groups']}
    counts = {}
    for r in rows:
        if not r['out']: counts[r['day']] = counts.get(r['day'], 0) + 1
    islas = []
    for h in st.get('history', []):
        w = h.get('winner') or {}
        d = h['day']
        islas.append(dict(day=d, act=acts.get(d, h.get('act')), label=labels.get(d, h.get('act')), user=w.get('user', ''), text=w.get('text', ''), likes=int(w.get('likes', 0) or 0), n=counts.get(d, 0)))
    base = os.path.dirname(os.path.abspath(__file__))
    pub = os.path.join(base, '..', 'public', 'data.json')
    json.dump(dict(day=st['day'], islas=islas, p=[[r['num'], r['handle'], r['day'], r['act'], r['s'], r['h'], r['k'], r['pa'], r['out']] for r in rows]),
              open(pub, 'w'), ensure_ascii=False, separators=(',', ':'))
    vivos = sum(1 for r in rows if not r['out'])
    print(f'{len(islas)} islas · ', end='')
    print(f'{len(rows)} pixelitos ({vivos} siguen, {len(rows) - vivos} se fueron) -> public/data.json')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'scripts/estado.json')
