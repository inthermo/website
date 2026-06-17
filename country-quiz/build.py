import json, re, unicodedata

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii','ignore').decode()
    return re.sub(r'[^a-z0-9]','', s.lower())

mled = json.load(open('mledoze.json'))
pop  = json.load(open('pop.json'))
geo  = json.load(open('ne110m.geojson'))

# population lookup by normalized name
poplook = {}
for r in pop:
    if r.get('country') and r.get('population'):
        poplook[norm(r['country'])] = r['population']

CONT = {'Africa','Americas','Asia','Europe','Oceania'}  # drop Antarctic
countries = []
byname = {}   # norm name/altspelling -> cca3
for c in mled:
    region = c.get('region','')
    if region not in CONT:
        continue
    name = c['name']['common']
    cca3 = c['cca3']
    caps = c.get('capital') or []
    latlng = c.get('latlng') or [0,0]
    # population fuzzy
    p = poplook.get(norm(name))
    if p is None:
        for alt in [c['name'].get('official','')] + c.get('altSpellings',[]):
            if norm(alt) in poplook:
                p = poplook[norm(alt)]; break
    entry = {
        'cca3': cca3,
        'cca2': c['cca2'],
        'name': name,
        'official': c['name'].get('official',''),
        'capital': caps[0] if caps else None,
        'continent': region,
        'subregion': c.get('subregion','') or region,
        'area': c.get('area'),
        'population': p,
        'flag': c.get('flag',''),
        'latlng': latlng,
        'landlocked': c.get('landlocked', False),
        'alt': c.get('altSpellings',[]),
        'languages': list((c.get('languages') or {}).values()),
        'borders': c.get('borders',[]),
        'independent': c.get('independent', None),
    }
    countries.append(entry)
    for k in [name, c['name'].get('official','')] + c.get('altSpellings',[]):
        if k: byname.setdefault(norm(k), cca3)

# Map geometry -> cca3. Fix Natural Earth -99 via name.
NE_FIX = {}  # ADMIN name norm overrides
geo_out = {'type':'FeatureCollection','features':[]}
valid = {c['cca3'] for c in countries}
matched = set()
for f in geo['features']:
    p = f['properties']
    iso = p.get('ISO_A3')
    if iso in (None,'-99') or iso not in valid:
        # try name match
        cand = None
        for key in ('ADMIN','NAME','SOVEREIGNT','BRK_NAME','NAME_LONG'):
            if p.get(key) and norm(p[key]) in byname:
                cand = byname[norm(p[key])]; break
        iso = cand
    if iso and iso in valid:
        geo_out['features'].append({'type':'Feature','id':iso,
            'properties':{'cca3':iso},'geometry':f['geometry']})
        matched.add(iso)

json.dump(countries, open('countries.json','w'), separators=(',',':'), ensure_ascii=False)
json.dump(geo_out, open('geo.json','w'), separators=(',',':'), ensure_ascii=False)

print('countries:', len(countries))
print('with geometry:', len(matched), '| without:', len(valid-matched))
print('by continent:')
from collections import Counter
for k,v in Counter(c['continent'] for c in countries).most_common():
    print('  ',k,v)
print('no-pop:', sum(1 for c in countries if c['population'] is None))
print('no-cap:', sum(1 for c in countries if not c['capital']))
print('sample missing geom:', sorted(list(valid-matched))[:15])
