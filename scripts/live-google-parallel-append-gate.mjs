/**
 * Live-Google Parallel-Append gate (§23/Exact Protocol §24).
 *
 * Run only against a disposable, dedicated Google test spreadsheet:
 *   GOOGLE_LIVE_ACCESS_TOKEN=... GOOGLE_LIVE_SPREADSHEET_ID=... GOOGLE_LIVE_RECORD_SHEET_ID=... npm run test:live-google-parallel-append
 *
 * The spreadsheet must not contain user/health data. This harness appends two
 * unique sentinel rows concurrently with two independent HTTP requests and
 * requires both to appear exactly once, adjacent, in one stable physical order.
 * It repeats the experiment so provider behaviour is observed rather than
 * inferred from a successful HTTP response.
 */
const token=process.env.GOOGLE_LIVE_ACCESS_TOKEN
const spreadsheetId=process.env.GOOGLE_LIVE_SPREADSHEET_ID
const sheetId=Number(process.env.GOOGLE_LIVE_RECORD_SHEET_ID)
const rounds=Number(process.env.GOOGLE_LIVE_PARALLEL_ROUNDS??'20')
if(!token||!spreadsheetId||!Number.isInteger(sheetId)||sheetId<0)throw new Error('Live-Google gate requires GOOGLE_LIVE_ACCESS_TOKEN, GOOGLE_LIVE_SPREADSHEET_ID and GOOGLE_LIVE_RECORD_SHEET_ID.')
if(!Number.isInteger(rounds)||rounds<10||rounds>100)throw new Error('GOOGLE_LIVE_PARALLEL_ROUNDS must be an integer from 10 through 100.')

const api=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
async function json(url,init={}){
  const response=await fetch(url,{...init,headers:{...headers,...init.headers}})
  const text=await response.text()
  if(!response.ok)throw new Error(`Google API ${response.status}: ${text.slice(0,500)}`)
  return text?JSON.parse(text):{}
}
async function append(row){
  const body={requests:[{appendCells:{sheetId,fields:'userEnteredValue',rows:[{values:row.map(value=>({userEnteredValue:{stringValue:value}}))}]}}]}
  await json(`${api}:batchUpdate`,{method:'POST',body:JSON.stringify(body)})
}
async function physicalRows(){
  const range=encodeURIComponent("'_r'!A:C")
  const fields=encodeURIComponent('sheets(data(startRow,rowData(values(userEnteredValue))))')
  const data=await json(`${api}?ranges=${range}&includeGridData=true&fields=${fields}`)
  const rows=data.sheets?.[0]?.data?.[0]?.rowData??[]
  return rows.map(row=>(row.values??[]).map(cell=>cell.userEnteredValue?.stringValue??''))
}
const prefix=`eds-live-parallel-${Date.now()}-${crypto.randomUUID()}`
for(let round=0;round<rounds;round++){
  const a=[`${prefix}-${round}-A`,'sentinel','A'],b=[`${prefix}-${round}-B`,'sentinel','B']
  await Promise.all([append(a),append(b)])
  const rows=await physicalRows()
  const ai=rows.findIndex(row=>row[0]===a[0]),bi=rows.findIndex(row=>row[0]===b[0])
  if(ai<0||bi<0)throw new Error(`Round ${round}: successful parallel append was not fully observable.`)
  if(rows.filter(row=>row[0]===a[0]).length!==1||rows.filter(row=>row[0]===b[0]).length!==1)throw new Error(`Round ${round}: sentinel row duplicated.`)
  if(Math.abs(ai-bi)!==1)throw new Error(`Round ${round}: parallel rows were not adjacent (A=${ai}, B=${bi}).`)
  const again=await physicalRows()
  if(again[ai]?.[0]!==rows[ai]?.[0]||again[bi]?.[0]!==rows[bi]?.[0])throw new Error(`Round ${round}: observed physical row order was not stable across full reread.`)
  process.stdout.write(`round ${round+1}/${rounds}: ${ai<bi?'A,B':'B,A'}\n`)
}
process.stdout.write(`PASS: ${rounds} parallel AppendCellsRequest pairs were each observed exactly once in a stable physical row order.\n`)
