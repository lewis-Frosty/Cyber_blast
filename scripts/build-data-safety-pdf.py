from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether)

CYAN   = colors.HexColor('#0B7C８C'.replace('８','8'))
INK    = colors.HexColor('#14121F')
DIM    = colors.HexColor('#5A5570')
LIME   = colors.HexColor('#3F7A12')
AMBER  = colors.HexColor('#9A6100')
RED    = colors.HexColor('#A32020')
RULE   = colors.HexColor('#D8D5E4')
BAND   = colors.HexColor('#F2F1F7')
OUT = '/home/user/cyber_blast/docs/launch/cyber-blast-data-safety.pdf'

def S(name, size=9.5, leading=13.5, color=INK, space_before=0, space_after=5,
      bold=False, left=0):
    return ParagraphStyle(name, fontName='Helvetica-Bold' if bold else 'Helvetica',
                          fontSize=size, leading=leading, textColor=color,
                          spaceBefore=space_before, spaceAfter=space_after,
                          leftIndent=left, alignment=TA_LEFT)

body   = S('body')
h1     = S('h1', 19, 23, CYAN, 0, 3, True)
h2     = S('h2', 12.5, 16, INK, 14, 6, True)
sub    = S('sub', 9, 12, DIM, 0, 12)
small  = S('small', 8.3, 11, DIM, 0, 4)
cell   = S('cell', 8.4, 11)
cellb  = S('cellb', 8.4, 11, INK, 0, 0, True)
celld  = S('celld', 8.4, 11, DIM)

def header(c, d):
    c.saveState()
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 8)
    c.drawString(18*mm, A4[1]-12*mm, 'CYBER BLAST')
    c.setFillColor(DIM); c.setFont('Helvetica', 8)
    c.drawString(45*mm, A4[1]-12*mm, 'Google Play — Data safety declaration')
    c.drawRightString(A4[0]-18*mm, A4[1]-12*mm, '10 Sep 2026  ·  v0.9.0')
    c.setStrokeColor(RULE); c.setLineWidth(0.5)
    c.line(18*mm, A4[1]-14.5*mm, A4[0]-18*mm, A4[1]-14.5*mm)
    c.setFillColor(DIM); c.setFont('Helvetica', 7.5)
    c.drawRightString(A4[0]-18*mm, 12*mm, 'Page %d' % d.page)
    c.drawString(18*mm, 12*mm, 'Draft prepared from the app source. Verify before submitting.')
    c.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                      topMargin=20*mm, bottomMargin=17*mm,
                      title='Cyber Blast — Google Play Data safety declaration',
                      author='Cyber Blast')
doc.addPageTemplates([PageTemplate(id='n',
    frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')],
    onPage=header)])

W = doc.width
st = []

st.append(Paragraph('Data safety declaration', h1))
st.append(Paragraph('Answers for the Google Play Console → Policy → App content → Data safety form. '
                    'Every answer below was derived by reading the Cyber Blast source, schema and '
                    'network calls — not from the design documents.', sub))

# ---- top-level answers
st.append(Paragraph('Section 1 — Data collection and security', h2))
rows = [[Paragraph('Question', cellb), Paragraph('Answer', cellb), Paragraph('Basis', cellb)]]
for q, a, b in [
 ('Does your app collect or share any of the required user data types?',
  'Yes',
  'The app sends a display name, avatar, country and game results to its own Supabase backend.'),
 ('Is all of the user data collected by your app encrypted in transit?',
  'Yes',
  'All backend calls are HTTPS to *.supabase.co. Capacitor serves the bundled app over the https scheme; '
  'android:allowMixedContent is false, so a plaintext request cannot be made.'),
 ('Do you provide a way for users to request that their data be deleted?',
  'Yes — by email only',
  'The privacy policy gives a deletion address. There is NO in-app delete button yet. See Section 4.'),
]:
    rows.append([Paragraph(q, cell), Paragraph('<b>%s</b>' % a, cell), Paragraph(b, celld)])
t = Table(rows, colWidths=[W*0.36, W*0.16, W*0.48])
t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0),BAND),
    ('LINEBELOW',(0,0),(-1,-1),0.4,RULE),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
    ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
]))
st.append(t)

# ---- data types
st.append(Paragraph('Section 2 — Data types to declare as COLLECTED', h2))
st.append(Paragraph('“Shared” in Play’s sense means transferred to a third party. Showing a name on a '
                    'leaderboard to other players is not sharing, but it is noted below because it is '
                    'publicly visible and that must be disclosed to users.', small))

# Three one-word columns could not hold their own headers at this size, so
# collected / shared / required are merged into one legible cell.
rows = [[Paragraph(x, cellb) for x in
         ('Category → Type','Collected · Shared · Req','Purpose','What it actually is')]]
data = [
 ('Personal info → Name','Yes','No','Opt.',
  'App functionality',
  'Player-chosen display name, max 12 chars, A–Z 0–9 and space only. Defaults to “ANON”. '
  'Visible to other players on leaderboards.'),
 ('Personal info → Other info','Yes','No','Opt.',
  'App functionality',
  'Two-letter country code for the country leaderboard. Guessed from the device LANGUAGE setting '
  '(navigator.languages), never from GPS or IP. User-editable and clearable.'),
 ('App activity → In-app search history','No','—','—','—','No search exists in the app.'),
 ('App activity → Other actions','Yes','No','Req.',
  'App functionality, Analytics',
  'Game results: score, pieces placed, longest chain, duration, mode, challenge date, plus totals '
  '(games played, best score, best chain, daily streak) and in-game XP/currency and league points.'),
 ('App info & performance → Crash logs','No','—','—','—',
  'No crash reporting SDK is present. Revisit if one is added.'),
 ('App info & performance → Diagnostics','No','—','—','—','No analytics or performance SDK is present.'),
 ('Device or other IDs → Device or other IDs','Yes','No','Req.',
  'App functionality',
  'A random UUID from Supabase anonymous auth, scoped to this app. Not an advertising ID, not a '
  'hardware ID, not linked to any Google account. See note in Section 3.'),
]
for r in data:
    if r[1] == 'No':
        flags = '<b>Not collected</b>'
    else:
        flags = '<b>Collected</b> · not shared · %s' % ('required' if r[3] == 'Req.' else 'optional')
    rows.append([Paragraph(r[0], cellb), Paragraph(flags, cell),
                 Paragraph(r[4], cell), Paragraph(r[5], celld)])
t = Table(rows, colWidths=[W*0.185, W*0.20, W*0.135, W*0.48], repeatRows=1)
t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0),BAND),
    ('LINEBELOW',(0,0),(-1,-1),0.4,RULE),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
    ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
]))
st.append(t)

st.append(Paragraph('Section 3 — Deliberate “No” answers, and why', h2))
st.append(Paragraph('Recorded so a future reviewer can tell a considered “No” from an oversight.', small))
rows = [[Paragraph(x, cellb) for x in ('Not declared','Reason')]]
for a,b in [
 ('Email address, phone, real name',
  'The app has no sign-in. Supabase anonymous auth issues a UUID and nothing else; there is no field '
  'anywhere in the app that asks for these.'),
 ('Approximate or precise location',
  'Country comes from the device language tag, not from IP geolocation or GPS. No location permission '
  'is requested and none is in the manifest — INTERNET is the only permission declared.'),
 ('Photos, videos, audio, files, contacts, calendar',
  'No such permission and no picker. Avatars are twelve built-in images drawn procedurally in code; '
  'there is no upload path.'),
 ('Financial info / purchase history',
  'The app is free with no in-app purchases and no billing library. This MUST be revisited before '
  'the planned $2.99 no-ads purchase ships.'),
 ('Advertising ID',
  'No ads SDK is present. This MUST be revisited before AdMob is added — adding AdMob changes this '
  'form and the ads declaration.'),
 ('Messages, contacts, health, SMS',
  'The app has no chat, messaging, friend list or social feature of any kind.'),
 ('The move log used for anti-cheat',
  'Sent to the server, replayed to compute the score, then DISCARDED. It is never written to the '
  'database — the runs table has no column for it. Processed ephemerally, so not declarable as '
  'collected; disclosed in the privacy policy regardless.'),
 ('IP address in server logs',
  'Supabase records IP and user-agent in standard server logs. Play’s data-type taxonomy has no IP '
  'category, so there is nothing to tick — but it IS disclosed in the privacy policy, which is where '
  'it belongs.'),
]:
    rows.append([Paragraph(a, cellb), Paragraph(b, celld)])
t = Table(rows, colWidths=[W*0.28, W*0.72], repeatRows=1)
t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0),BAND),
    ('LINEBELOW',(0,0),(-1,-1),0.4,RULE),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
    ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
]))
st.append(t)

st.append(Paragraph('Section 4 — Open items before this form is submitted', h2))
rows = [[Paragraph(x, cellb) for x in ('Priority','Item','Action')]]
items = [
 ('HIGH', RED, 'No in-app data deletion',
  'Play requires apps that let users create an account to offer account deletion, including a web '
  'request path. Cyber Blast creates an anonymous account automatically, which is a grey area — but '
  'the safe reading is to provide it. Recommend a DELETE MY DATA button in the Profile screen calling '
  'a delete-account Edge Function. Roughly half a day.'),
 ('HIGH', RED, 'Contact email is a placeholder',
  'privacy.html contains “PLACEHOLDER — your contact email” in two places. The policy cannot go live '
  'until a real monitored address replaces both.'),
 ('MED', AMBER, 'Privacy policy URL not yet live',
  'Page is written and routed. It publishes to https://<your-vercel-domain>/privacy on the next '
  'deploy. Paste that URL into Play Console → Store listing and App content.'),
 ('MED', AMBER, 'Ads declaration',
  'Answer “No, my app does not contain ads” for now. This must change the moment AdMob is added, '
  'together with the Advertising ID row in Section 2.'),
 ('LOW', DIM, 'Analytics purpose on game results',
  '“Analytics” is ticked for game results because scores drive leaderboards and league standing. '
  'If you prefer the narrowest accurate answer, App functionality alone is defensible; adding '
  'Analytics is the more conservative choice and is what is recommended here.'),
]
for p, col, it, ac in items:
    rows.append([Paragraph('<b>%s</b>' % p, S('p',8.4,11,col,0,0,True)),
                 Paragraph(it, cellb), Paragraph(ac, celld)])
t = Table(rows, colWidths=[W*0.09, W*0.26, W*0.65], repeatRows=1)
t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0),BAND),
    ('LINEBELOW',(0,0),(-1,-1),0.4,RULE),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
    ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
]))
st.append(t)

st.append(Spacer(1, 8))
st.append(Paragraph('This is a working draft prepared from the source code, not legal advice. You are the '
                    'data controller and are responsible for the accuracy of what you submit. Play '
                    'rejects apps whose Data safety answers do not match observed app behaviour, so '
                    're-check this document whenever an SDK, permission or backend field is added.',
                    S('note', 8.3, 11.5, DIM)))

doc.build(st)
print('wrote', OUT)
