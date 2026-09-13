from pathlib import Path
import hashlib

path = Path('src/features/pain/bodyMap/BodyMapSelector.tsx')
text = path.read_text()

def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one occurrence, found {count}: {old!r}')
    text = text.replace(old, new, 1)

replace_once(
    "import { GluteDetailSelector, gluteDetailLabel, isGluteRegionId } from './GluteDetailSelector'\n",
    "import { GluteDetailSelector, gluteDetailLabel, isGluteRegionId } from './GluteDetailSelector'\n"
    "import { AbdomenDetailSelector, abdomenDetailLabel, isAbdomenRegionId } from './AbdomenDetailSelector'\n",
)
replace_once(
    "  if (isGluteRegionId(location.regionId, location.view)) return gluteDetailLabel(id)\n  return handDetailLabel(id, location.view)",
    "  if (isGluteRegionId(location.regionId, location.view)) return gluteDetailLabel(id)\n"
    "  if (isAbdomenRegionId(location.regionId, location.view)) return abdomenDetailLabel(id)\n"
    "  return handDetailLabel(id, location.view)",
)
replace_once(
    "  isFootRegionId(regionId, view) || isGluteRegionId(regionId, view)",
    "  isFootRegionId(regionId, view) || isGluteRegionId(regionId, view) || isAbdomenRegionId(regionId, view)",
)
replace_once(
    "  if (isGluteRegionId(location.regionId, location.view)) return location.regionId === 'left-glute' ? 'Linke Gesäß- / Hüftregion' : 'Rechte Gesäß- / Hüftregion'\n  return `${location.regionId === 'left-hand' ? 'Linke' : 'Rechte'} Hand`",
    "  if (isGluteRegionId(location.regionId, location.view)) return location.regionId === 'left-glute' ? 'Linke Gesäß- / Hüftregion' : 'Rechte Gesäß- / Hüftregion'\n"
    "  if (isAbdomenRegionId(location.regionId, location.view)) return 'Bauch'\n"
    "  return `${location.regionId === 'left-hand' ? 'Linke' : 'Rechte'} Hand`",
)
replace_once(
    "      {detailTarget && detailLocation && isGluteRegionId(detailTarget.regionId, detailTarget.view) && (\n"
    "        <GluteDetailSelector side={detailTarget.regionId === 'left-glute' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />\n"
    "      )}\n\n      <div className=\"body-map-selector__selection\" aria-live=\"polite\">",
    "      {detailTarget && detailLocation && isGluteRegionId(detailTarget.regionId, detailTarget.view) && (\n"
    "        <GluteDetailSelector side={detailTarget.regionId === 'left-glute' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />\n"
    "      )}\n"
    "      {detailTarget && detailLocation && isAbdomenRegionId(detailTarget.regionId, detailTarget.view) && (\n"
    "        <AbdomenDetailSelector value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />\n"
    "      )}\n\n      <div className=\"body-map-selector__selection\" aria-live=\"polite\">",
)

path.write_text(text)
expected = '976f58f52787c8b536461b37f56e0212d92ba2d201194d67f068cd1998b40119'
got = hashlib.sha256(path.read_bytes()).hexdigest()
if got != expected:
    raise SystemExit(f'BodyMapSelector SHA256 mismatch: {got} != {expected}')
print(f'BodyMapSelector.tsx: {got} OK')
