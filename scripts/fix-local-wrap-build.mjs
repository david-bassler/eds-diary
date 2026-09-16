import fs from 'node:fs'

function replaceOnce(path,before,after,label){let source=fs.readFileSync(path,'utf8');const count=source.split(before).length-1;if(count!==1)throw new Error(`${label}: expected 1, found ${count}`);source=source.replace(before,after);fs.writeFileSync(path,source)}

replaceOnce('src/App.tsx',"  }, [])\n\n  function navigate", "  }, [activeSection])\n\n  function navigate",'App effect dependency')

const activity='src/features/activity/ActivityPage.tsx'
replaceOnce(activity,"  useEffect(() => {\n    let active = true\n\n    setActiveRangeIndex(null)\n    setActiveDraft(null)\n    setUndoStack([])\n    setRedoStack([])\n    setTimeRanges([])\n    setRangeDetails([])\n    setRangeRecords([])\n\n    void listActivityEntries()", "  useEffect(() => {\n    let active = true\n\n    void listActivityEntries()",'activity date sync resets')
replaceOnce(activity,"        const selectedEntries = entriesForDate(entries, date)\n        applyStoredEntries(selectedEntries)", "        const selectedEntries = entriesForDate(entries, date)\n        const displayNow = localNowTime()\n        setTimeRanges(selectedEntries.map((entry) => ({start: entry.startTime,end: entry.isOngoing ? ongoingDisplayEnd(entry.startTime, entry.date, displayNow) : entry.endTime})))\n        setRangeDetails(selectedEntries.map((entry) => ({activityName: entry.activityName,color: entry.color,note: entry.note,isOngoing: entry.isOngoing})))\n        setRangeRecords([...selectedEntries])",'activity effect application')
replaceOnce(activity,"    let active = true\n    setCopyLoading(true)\n    setCopyError('')\n\n    void listActivityEntries()", "    let active = true\n\n    void listActivityEntries()",'activity copy effect sync state')
replaceOnce(activity,"  function openCopyDay(): void {\n    setCopySourceDate(previousDate(date))", "  function openCopyDay(): void {\n    setCopyLoading(true)\n    setCopySourceDate(previousDate(date))",'activity copy open loading')
replaceOnce(activity,"  function toggleCopyEntry(id: string, selected: boolean): void {", "  function changeDate(nextDate: string): void {\n    setActiveRangeIndex(null)\n    setActiveDraft(null)\n    setUndoStack([])\n    setRedoStack([])\n    setTimeRanges([])\n    setRangeDetails([])\n    setRangeRecords([])\n    setDate(nextDate)\n  }\n\n  function toggleCopyEntry(id: string, selected: boolean): void {",'activity date handler')
replaceOnce(activity,"            onChange={(event) => setDate(event.target.value)}", "            onChange={(event) => changeDate(event.target.value)}",'activity date input')
replaceOnce(activity,"        onSourceDateChange={(nextDate) => {\n          setCopySourceDate(nextDate)\n          setCopyError('')", "        onSourceDateChange={(nextDate) => {\n          setCopyLoading(true)\n          setCopySourceDate(nextDate)\n          setCopyError('')",'activity source date')

const medication='src/features/medication/MedicationPage.tsx'
replaceOnce(medication,"    let active = true\n    setCopyLoading(true)\n    setCopyError('')\n\n    void listMedicationEntries()", "    let active = true\n\n    void listMedicationEntries()",'med copy effect state')
replaceOnce(medication,"  function openCopyDay(): void {\n    setCopySourceDate(previousDate(date))", "  function openCopyDay(): void {\n    setCopyLoading(true)\n    setCopySourceDate(previousDate(date))",'med copy open')
replaceOnce(medication,"        onSourceDateChange={(nextDate) => {\n          setCopySourceDate(nextDate)\n          setCopyError('')", "        onSourceDateChange={(nextDate) => {\n          setCopyLoading(true)\n          setCopySourceDate(nextDate)\n          setCopyError('')",'med source date')

replaceOnce('src/features/pain/PainEntryList.tsx',"  const loadEntries = useCallback(async () => {\n    setLoading(true)\n    try {", "  const loadEntries = useCallback(async () => {\n    try {",'pain loading sync state')

const detailFiles=['AbdomenDetailSelector.tsx','FootDetailSelector.tsx','GluteDetailSelector.tsx','HandDetailSelector.tsx','HeadDetailSelector.tsx','HipDetailSelector.tsx','KneeDetailSelector.tsx','LowerBackDetailSelector.tsx','ShoulderDetailSelector.tsx']
for(const file of detailFiles)replaceOnce(`src/features/pain/bodyMap/${file}`,"    setHitMap(null)\n\n",'',`${file} hitmap reset`)
replaceOnce('src/features/pain/bodyMap/BodyMapSelector.tsx',"\n  useEffect(() => {\n    if (detailTarget && !detailLocation) setDetailTarget(null)\n  }, [detailLocation, detailTarget])\n",'', 'body map derived detail target')

const qr='src/features/share/QrShareButton.tsx'
replaceOnce(qr,"  const [generatorAvailable, setGeneratorAvailable] = useState(true)", "  const [generatorAvailable, setGeneratorAvailable] = useState(() => Boolean(getQrCodeConstructor()))",'qr initial availability')
replaceOnce(qr,"    const QRCode = getQrCodeConstructor()\n    if (!QRCode) {\n      setGeneratorAvailable(false)\n      return\n    }\n\n    setGeneratorAvailable(true)\n    new QRCode", "    const QRCode = getQrCodeConstructor()\n    if (!QRCode) return\n\n    new QRCode",'qr effect state')
replaceOnce(qr,"  function openQrCode(): void {\n    setUrl(window.location.href)", "  function openQrCode(): void {\n    setGeneratorAvailable(Boolean(getQrCodeConstructor()))\n    setUrl(window.location.href)",'qr event availability')
