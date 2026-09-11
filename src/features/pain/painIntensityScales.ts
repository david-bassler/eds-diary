export interface PainIntensityScale {
  id: string
  name: string
  sourceUrl: string
  descriptions: readonly string[]
}

export const PAIN_INTENSITY_SCALES: readonly PainIntensityScale[] = [
  {
    id: 'nrs',
    name: 'Numerische Ratingskala (NRS)',
    sourceUrl:
      'https://www.ncbi.nlm.nih.gov/books/NBK525003/table/chronicpainmeasures.suppl1.tab3/',
    descriptions: [
      'Kein Schmerz.',
      'Leichter Schmerz – unterer Bereich der üblichen NRS-Einteilung.',
      'Leichter Schmerz.',
      'Leichter Schmerz – oberer Bereich der üblichen NRS-Einteilung.',
      'Mittlerer Schmerz – unterer Bereich der üblichen NRS-Einteilung.',
      'Mittlerer Schmerz.',
      'Mittlerer Schmerz – oberer Bereich der üblichen NRS-Einteilung.',
      'Starker Schmerz – unterer Bereich der üblichen NRS-Einteilung.',
      'Starker Schmerz.',
      'Sehr starker Schmerz.',
      'Schmerz so schlimm, wie du ihn dir vorstellen kannst.',
    ],
  },
  {
    id: 'dvprs',
    name: 'Defense and Veterans Pain Rating Scale (DVPRS 2.0)',
    sourceUrl:
      'https://www.va.gov/PAINMANAGEMENT/docs/DVPRS_2slides_and_references.pdf',
    descriptions: [
      'Kein Schmerz.',
      'Kaum bemerkbar.',
      'Bemerkbar, ohne Tätigkeiten zu beeinträchtigen.',
      'Lenkt manchmal ab.',
      'Lenkt ab, übliche Tätigkeiten sind aber noch möglich.',
      'Unterbricht einige Tätigkeiten.',
      'Schwer zu ignorieren; übliche Tätigkeiten werden vermieden.',
      'Steht im Mittelpunkt der Aufmerksamkeit und verhindert alltägliche Tätigkeiten.',
      'Sehr schlimm; fast alles fällt schwer.',
      'Kaum auszuhalten; Tätigkeiten sind praktisch nicht mehr möglich.',
      'So schlimm wie möglich; nichts anderes zählt mehr.',
    ],
  },
  {
    id: 'functional',
    name: 'Robert Packer Hospital Functional Pain Scale (RPH-FPS)',
    sourceUrl:
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC8425136/',
    descriptions: [
      'Kein Schmerz.',
      'Kaum bemerkbar; Alltag und Schlaf sind nicht beeinträchtigt.',
      'Ohne Ablenkung bemerkbar; Alltag normal, Schlaf höchstens leicht betroffen.',
      'Vorhanden, aber alle Alltagstätigkeiten sind möglich; Schlaf ist leicht betroffen.',
      'Ständig bewusst; Alltag mit Anpassungen möglich, aktive Ablenkung kann helfen.',
      'Lenkt deutlich ab; nur ein Teil der Alltagstätigkeiten gelingt, Schlaf ist beeinträchtigt.',
      'Belastend; die meisten Alltagstätigkeiten gelingen nicht, Schlaf und Ablenkung sind schwierig.',
      'Nicht mehr gut handhabbar; normale Alltagstätigkeiten werden verhindert, Schlaf und Konzentration sind stark beeinträchtigt.',
      'Sehr intensiv; Alltag nur mit viel Hilfe, Konzentration und Gespräch sind schwierig, Schlaf kaum möglich.',
      'Extrem; Alltag auch mit Hilfe kaum möglich, Sprechen fällt schwer und Schlaf ist nicht möglich.',
      'Immobilisierend; Bewegung oder Sprechen sind wegen der Schmerzintensität nicht möglich.',
    ],
  },
  {
    id: 'mankoski',
    name: 'Mankoski Pain Scale',
    sourceUrl: 'https://www.painscale.com/article/mankoski-pain-scale',
    descriptions: [
      'Schmerzfrei.',
      'Sehr geringe, gelegentliche Beschwerden.',
      'Geringe Beschwerden mit einzelnen stärkeren Schmerzspitzen.',
      'So störend, dass der Schmerz ablenkt.',
      'Bei starker Beschäftigung noch zeitweise ignorierbar, aber weiterhin ablenkend.',
      'Lässt sich höchstens für kurze Zeit ignorieren.',
      'Kann nicht mehr ignoriert werden; Arbeit oder soziale Aktivität können noch möglich sein.',
      'Konzentration und Schlaf werden schwierig; Funktionieren gelingt nur mit Anstrengung.',
      'Körperliche Aktivität ist stark eingeschränkt; Lesen oder Gespräch gelingen nur mit Mühe.',
      'Kommunikation ist kaum oder nicht mehr möglich; der Schmerz überwältigt die Wahrnehmung.',
      'Der Schmerz kann bis zur Bewusstlosigkeit führen.',
    ],
  },
  {
    id: 'eds',
    name: 'EDS Awareness Comparative Pain Scale',
    sourceUrl: 'https://www.chronicpainpartners.com/comparative-pain-scale/',
    descriptions: [
      'Kein Schmerz.',
      'Sehr mild und kaum bemerkbar.',
      'Leicht unangenehm und klar wahrnehmbar.',
      'Deutlich, aber noch gut anpassbar.',
      'Belastender, tiefer Schmerz.',
      'Sehr belastend; der normale Alltag wird unterbrochen.',
      'Intensiv; der Schmerz beansprucht die Sinne und erschwert klares Denken.',
      'Sehr intensiv; der Schmerz dominiert die Wahrnehmung und klares Denken ist häufig schwierig.',
      'Extrem; klares Denken ist kaum noch möglich.',
      'Quälend und kaum erträglich; normales Funktionieren bricht weitgehend zusammen.',
      'Unvorstellbar stark; der Schmerz kann zu Bewusstseinsverlust führen.',
    ],
  },
]
