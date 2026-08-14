"""Builds the TOP-Feedback introduction deck.

Design follows the app itself so the slides and the product read as one thing:
the same navy, the same neutral greys, the same restraint. Every screenshot is
the real app with real seeded data — nothing is mocked up.
"""

import struct
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

SHOTS = Path(sys.argv[1])
OUT = Path(sys.argv[2])

NAVY = RGBColor(0x1C, 0x4F, 0x8B)
NAVY_DK = RGBColor(0x16, 0x3F, 0x70)
INK = RGBColor(0x14, 0x18, 0x1F)
MUTED = RGBColor(0x55, 0x60, 0x6E)
FAINT = RGBColor(0x8A, 0x93, 0x9F)
TINT = RGBColor(0xEE, 0xF3, 0xFA)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
RULE = RGBColor(0xD8, 0xDE, 0xE8)
OK = RGBColor(0x1C, 0x6B, 0x3F)
WARN = RGBColor(0x8A, 0x5A, 0x05)
DANGER = RGBColor(0xA0, 0x27, 0x24)

SANS = "Helvetica Neue"
MONO = "Menlo"

W, H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.85)

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]


def png_size(path):
    """Width/height straight from the PNG header — no image library needed."""
    with open(path, "rb") as fh:
        head = fh.read(24)
    return struct.unpack(">II", head[16:24])


def blank():
    return prs.slides.add_slide(BLANK)


def fill(slide, color):
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = color
    bg.line.fill.background()
    bg.shadow.inherit = False
    return bg


def rect(slide, x, y, w, h, color, line=None, radius=None):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, x, y, w, h)
    if radius:
        shape.adjustments[0] = radius
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    if line:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def text(slide, x, y, w, h, runs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    """runs: list of (string, size_pt, bold, color, space_after_pt)."""
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, (body, size, bold, color, after) in enumerate(runs):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = align
        para.space_after = Pt(after)
        para.line_spacing = 1.18
        run = para.add_run()
        run.text = body
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = SANS
    return box


def bullets(slide, x, y, w, items, size=17, gap=15, color=INK):
    """Items are (text, bold) or plain strings; a leading '·' marks a sub-point."""
    box = slide.shapes.add_textbox(x, y, w, Inches(4))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, item in enumerate(items):
        body = item if isinstance(item, str) else item[0]
        sub = body.startswith("·")
        if sub:
            body = body[1:].strip()
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.space_after = Pt(gap if not sub else gap - 4)
        para.line_spacing = 1.25
        para.level = 1 if sub else 0
        run = para.add_run()
        run.text = ("—  " if sub else "")+ body
        run.font.size = Pt(size - 2 if sub else size)
        run.font.color.rgb = MUTED if sub else color
        run.font.name = SANS
        run.font.bold = bool(not isinstance(item, str) and item[1])
    return box


def notes(slide, body):
    slide.notes_slide.notes_text_frame.text = body


def eyebrow(slide, label):
    text(slide, MARGIN, Inches(0.62), Inches(9), Inches(0.3),
         [(label.upper(), 11, True, NAVY, 0)])


def heading(slide, title, sub=None):
    text(slide, MARGIN, Inches(1.0), Inches(11.6), Inches(1.0),
         [(title, 34, True, INK, 0)])
    if sub:
        text(slide, MARGIN, Inches(1.85), Inches(10.6), Inches(0.6),
             [(sub, 16, False, MUTED, 0)])


def picture(slide, name, x, y, max_w, max_h, border=True):
    """Places an image scaled to fit the box, centred, never distorted."""
    path = SHOTS / name
    pw, ph = png_size(path)
    scale = min(max_w / pw, max_h / ph)
    w, h = int(pw * scale), int(ph * scale)
    left = int(x + (max_w - w) / 2)
    top = int(y + (max_h - h) / 2)
    if border:
        rect(slide, Emu(left - 9525), Emu(top - 9525), Emu(w + 19050), Emu(h + 19050), WHITE, RULE)
    return slide.shapes.add_picture(str(path), Emu(left), Emu(top), Emu(w), Emu(h))


def footer(slide, n):
    text(slide, Inches(12.0), Inches(6.95), Inches(0.6), Inches(0.3),
         [(str(n), 10, False, FAINT, 0)], align=PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- slides ----

def slide_title():
    s = blank()
    fill(s, NAVY)
    mark = rect(s, MARGIN, Inches(1.5), Inches(0.95), Inches(0.95), WHITE, radius=0.18)
    tick = s.shapes.add_textbox(MARGIN, Inches(1.62), Inches(0.95), Inches(0.7))
    p = tick.text_frame.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = "✓"
    r.font.size = Pt(40); r.font.bold = True; r.font.color.rgb = NAVY

    text(s, MARGIN, Inches(2.95), Inches(10), Inches(1.4), [("TOP-Feedback", 60, True, WHITE, 0)])
    text(s, MARGIN, Inches(4.25), Inches(9.5), Inches(0.8),
         [("The student and instructor feedback cycle,", 22, False, WHITE, 4),
          ("owned entirely by your detachment.", 22, False, WHITE, 0)])
    rect(s, MARGIN, Inches(5.75), Inches(1.2), Emu(28575), WHITE)
    text(s, MARGIN, Inches(6.05), Inches(9), Inches(0.5),
         [("An introduction  ·  What it does and how to use it", 14, False, WHITE, 0)])
    notes(s, "TOP-Feedback collects feedback from cadets and turns it into something an "
             "instructor can act on. The single most important thing about it: there is no vendor "
             "and no server. Every record lives in a Google Drive folder the detachment owns.")


def slide_problem():
    s = blank()
    eyebrow(s, "Why this exists")
    heading(s, "Feedback that nobody can act on")
    bullets(s, MARGIN, Inches(2.35), Inches(5.4), [
        "Paper forms get collected, stacked, and never counted.",
        "Survey tools put cadet feedback on a company's servers.",
        "Averages hide the thing you needed to see.",
        "A disclosure of hazing can sit unread in a pile for weeks.",
    ], size=18, gap=20)

    box = rect(s, Inches(7.1), Inches(2.2), Inches(5.35), Inches(3.5), TINT, radius=0.04)
    text(s, Inches(7.6), Inches(2.65), Inches(4.4), Inches(3),
         [("What this replaces", 15, True, NAVY, 14),
          ("One app that issues the form, collects the responses, does the "
           "statistics, reads the written answers, and flags anything that "
           "needs a person to act on it today.", 16, False, INK, 14),
          ("Runs on a phone. Works offline. Costs nothing.", 16, True, INK, 0)])
    footer(s, 2)
    notes(s, "Frame the problem before the product. The last bullet matters most to a commander: "
             "safety disclosures buried in unread paper.")


def slide_what():
    s = blank()
    eyebrow(s, "What it is")
    heading(s, "A web app with no server behind it")

    items = [
        ("Your Google account", "Every record is written to a Drive folder your detachment owns. "
                                "No vendor holds your data, because no vendor is involved."),
        ("Any device", "Opens in a browser and installs to a phone home screen. Cadets fill in "
                       "feedback on the walk out of the classroom."),
        ("Nothing to buy", "No licences, no subscription, no servers to maintain. Setup is a "
                           "Google folder and about 45 minutes."),
    ]
    x = MARGIN
    for i, (title, body) in enumerate(items):
        col = Inches(3.65)
        card = rect(s, x, Inches(2.5), col, Inches(3.1), WHITE, RULE, radius=0.05)
        rect(s, x, Inches(2.5), col, Emu(47625), NAVY)
        text(s, x + Inches(0.4), Inches(2.95), col - Inches(0.8), Inches(2.4),
             [(title, 19, True, INK, 12), (body, 14, False, MUTED, 0)])
        x += col + Inches(0.42)
    footer(s, 3)
    notes(s, "Three facts that answer the questions people always ask first: where does the data "
             "go, what do I need, what does it cost.")


def slide_data():
    s = blank()
    eyebrow(s, "Data ownership")
    heading(s, "Your folder is the database",
            "Each record is a plain JSON file you can open in Drive. Nothing is locked in a format only this app can read.")
    tree = rect(s, MARGIN, Inches(2.7), Inches(6.2), Inches(3.5), TINT, radius=0.04)
    body = ("TOP-Feedback/\n"
            "  config/      detachment profile and settings\n"
            "  users/       accounts — cadets, instructors, admins\n"
            "  forms/       feedback form definitions\n"
            "  requests/    feedback issued, each with an ID\n"
            "  responses/   submitted feedback\n"
            "  receipts/    who submitted — kept apart from\n"
            "               what they said\n"
            "  reports/     exported reports")
    tb = s.shapes.add_textbox(MARGIN + Inches(0.4), Inches(2.95), Inches(5.6), Inches(3))
    tf = tb.text_frame
    tf.word_wrap = False
    for i, line in enumerate(body.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(3)
        r = p.add_run(); r.text = line
        r.font.size = Pt(12); r.font.name = MONO
        r.font.color.rgb = NAVY if line.strip().endswith("/") else MUTED

    bullets(s, Inches(7.5), Inches(2.85), Inches(5.0), [
        ("If you stop using this app, you still have every response.", True),
        "·Readable in Drive, backed up by Google, recoverable from the trash for 30 days.",
        ("Access is controlled by folder sharing.", True),
        "·Who can read the feedback is a Drive permission, not a setting in this app.",
    ], size=16, gap=16)
    footer(s, 4)
    notes(s, "This slide answers the procurement question. There is no lock-in and no data "
             "processor. Emphasise that folder sharing is the real access control.")


def slide_roles():
    s = blank()
    eyebrow(s, "Three ways in")
    heading(s, "One app, three doors")
    picture(s, "home.png", MARGIN, Inches(2.25), Inches(6.6), Inches(4.1))
    bullets(s, Inches(8.0), Inches(2.5), Inches(4.5), [
        ("Student", True),
        "·Signs in, sees only the feedback assigned to them, submits it once.",
        ("Instructor Portal", True),
        "·Creates feedback, reads responses, runs the analysis.",
        ("Database Administration", True),
        "·Creates accounts and resets passwords.",
    ], size=16, gap=13)
    footer(s, 5)
    notes(s, "Everyone signs in, cadets included. That is what makes 'one submission per student' "
             "mean something rather than relying on an honour system.")


def slide_student_list():
    s = blank()
    eyebrow(s, "For cadets")
    heading(s, "Only what is assigned to you",
            "Filtered by school year, semester, class and due date. Completed feedback drops off the list.")
    picture(s, "student-list.png", MARGIN, Inches(2.6), Inches(11.6), Inches(4.0))
    footer(s, 6)
    notes(s, "A cadet sees their own list, not everything the detachment has ever issued. "
             "Scheduled forms stay hidden until their open date; overdue ones close automatically.")


def slide_scale():
    s = blank()
    eyebrow(s, "The rating scale")
    heading(s, "Cadets choose a word. The maths runs on the number.")
    picture(s, "student-form.png", MARGIN, Inches(2.35), Inches(7.3), Inches(4.3))
    bullets(s, Inches(8.6), Inches(2.6), Inches(3.9), [
        ("Nine points, every one named.", True),
        "·Detrimental · Significant · Unfavorable · Minor · Neutral · Slight · Favorable · Major · Outstanding",
        ("No numbers on screen.", True),
        "·A visible number invites people to average it in their heads while answering.",
        ("Written answers capped at 250 words", True),
        "·with a live counter.",
    ], size=15, gap=12)
    footer(s, 7)
    notes(s, "Neutral sits at 5, the true centre of a 1-9 scale. Instructors see both the word and "
             "the number; cadets only ever see the word.")


def slide_mobile():
    s = blank()
    fill(s, TINT)
    text(s, MARGIN, Inches(0.62), Inches(9), Inches(0.3), [("ON A PHONE", 11, True, NAVY, 0)])
    text(s, MARGIN, Inches(1.0), Inches(6.4), Inches(1.2), [("Built for the walk out\nof the classroom", 34, True, INK, 0)])
    bullets(s, MARGIN, Inches(2.9), Inches(5.6), [
        ("Installs to the home screen.", True),
        "·Opens like an ordinary app — no address to remember.",
        ("Works with no signal.", True),
        "·A submission made offline is saved on the device, shown as pending, and sent automatically when the connection returns.",
        ("Nothing is ever lost to a dropped connection.", True),
    ], size=16, gap=14)
    picture(s, "student-mobile.png", Inches(8.1), Inches(0.55), Inches(4.4), Inches(6.4), border=False)
    footer(s, 8)
    notes(s, "Classroom wifi is unreliable. The offline queue is why a cadet never loses what they "
             "typed. Reading existing feedback does need a connection.")


def slide_portal():
    s = blank()
    eyebrow(s, "For instructors")
    heading(s, "Two things to do, both one click away")
    picture(s, "instructor-portal.png", MARGIN, Inches(2.4), Inches(11.6), Inches(4.2))
    footer(s, 9)
    notes(s, "Create Feedback and Feedback Response and Analysis are the two headline actions. "
             "The tabs below hold the detail.")


def slide_create():
    s = blank()
    eyebrow(s, "Create feedback")
    heading(s, "A standardized form, in about two minutes")
    picture(s, "form-creator.png", MARGIN, Inches(2.35), Inches(7.0), Inches(4.3))
    bullets(s, Inches(8.3), Inches(2.6), Inches(4.2), [
        ("Name the class or event", True),
        ("Pick the AS level, term and dates", True),
        "·Scheduled forms stay hidden until they open.",
        ("Choose who gets it", True),
        "·Everyone at that level, or named cadets.",
        ("Add questions — minimum three", True),
        "·A rating, or a written answer. No maximum.",
        ("Every form gets an ID", True),
        "·FB-2026-0001, to quote in conversation.",
    ], size=14, gap=10)
    footer(s, 10)
    notes(s, "The form is deliberately narrow. That constraint is what makes results comparable "
             "across a detachment and across terms.")


def slide_ratings():
    s = blank()
    eyebrow(s, "Analysis · ratings")
    heading(s, "Everything a mean alone would hide")
    picture(s, "analysis-question.png", MARGIN, Inches(2.3), Inches(7.4), Inches(4.4))
    bullets(s, Inches(8.7), Inches(2.5), Inches(3.8), [
        ("Mean, median, mode, range, spread", True),
        ("Distribution across every point", True),
        "·Shape you can see, not infer.",
        ("Agreement, scored 0 to 1", True),
        "·Do they actually agree?",
        ("Outliers, found robustly", True),
        "·Against the median, so one extreme rating cannot hide itself.",
    ], size=14, gap=11)
    footer(s, 11)
    notes(s, "Point at the distribution. This example is bimodal — the mean of 5.75 describes "
             "nobody in the room.")


def slide_split():
    s = blank()
    fill(s, NAVY)
    text(s, MARGIN, Inches(1.5), Inches(11), Inches(2.2),
         [("A mean of 5 can mean everyone shrugged,", 34, True, WHITE, 8),
          ("or that half the flight thought it was outstanding", 34, True, WHITE, 8),
          ("and half thought it was harmful.", 34, True, WHITE, 0)])
    rect(s, MARGIN, Inches(4.3), Inches(1.4), Emu(28575), WHITE)
    text(s, MARGIN, Inches(4.7), Inches(10.5), Inches(1.6),
         [("Same number. Opposite situations. Only one of them needs acting on.", 19, False, WHITE, 14),
          ("TOP-Feedback detects the split, says so plainly, and tells you the average "
           "describes nobody — so you read both groups instead of the mean.", 17, False, WHITE, 0)])
    footer(s, 12)
    notes(s, "This is the single best argument for the analysis over a spreadsheet. A spreadsheet "
             "gives you the mean and stops.")


def slide_written():
    s = blank()
    eyebrow(s, "Analysis · written answers")
    heading(s, "Read the important ones first")
    bullets(s, MARGIN, Inches(2.4), Inches(5.6), [
        ("Sentiment, ranked most negative first", True),
        "·Handles negation and emphasis — 'not helpful' and 'extremely helpful' both score correctly.",
        ("Every answer is shown", True),
        "·Answers the lexicon cannot read are labelled, never hidden.",
        ("Runs on the device", True),
        "·No cloud service sees your cadets' words. That constraint is the reason it is a word list rather than a model — and the accuracy limits are stated on screen.",
    ], size=16, gap=13)
    picture(s, "wordcloud.png", Inches(6.9), Inches(2.35), Inches(5.6), Inches(4.2))
    text(s, Inches(6.9), Inches(6.65), Inches(5.6), Inches(0.4),
         [("Word cloud sized by how many people used a word — not how often it appears.",
           12, False, FAINT, 0)])
    footer(s, 13)
    notes(s, "Be honest in the room: sentiment reads words, not meaning. It is a triage aid for "
             "deciding what to read first, never a substitute for reading.")


def slide_safety():
    s = blank()
    eyebrow(s, "Safety screen")
    heading(s, "Nothing important sits unread")
    picture(s, "safety.png", MARGIN, Inches(2.3), Inches(7.6), Inches(4.4))
    bullets(s, Inches(8.9), Inches(2.5), Inches(3.6), [
        ("Every written answer is screened", True),
        "·Hazing, sexual harassment, discrimination, violence, self-harm, substances, integrity.",
        ("Matches are highlighted in context", True),
        ("A prompt, never a finding", True),
        "·It cannot tell 'we discussed hazing prevention' from 'I was hazed'. A person reads it and decides.",
    ], size=14, gap=11)
    footer(s, 14)
    notes(s, "State the limits out loud: it matches words, not meaning, and a clear screen is not "
             "proof that nothing was reported. Follow detachment reporting procedures.")


def slide_anonymity():
    s = blank()
    eyebrow(s, "Anonymity")
    heading(s, "Anonymous, and still able to chase people")

    cards = [
        ("How it works", NAVY,
         "The cadet signs in, so the app knows who they are. It writes a receipt in a separate "
         "folder, then discards the name. The response itself carries no identity."),
        ("What that buys", OK,
         "You can say “two cadets still owe feedback” about responses nobody can attribute — "
         "and nobody can submit twice."),
        ("The honest limit", WARN,
         "With very few responses a single answer can be identified by elimination. So anonymous "
         "results stay hidden until three people have responded."),
    ]
    x = MARGIN
    for title, color, body in cards:
        col = Inches(3.65)
        card = rect(s, x, Inches(2.45), col, Inches(3.2), WHITE, RULE, radius=0.05)
        rect(s, x, Inches(2.45), Emu(47625), Inches(3.2), color)
        text(s, x + Inches(0.42), Inches(2.85), col - Inches(0.85), Inches(2.5),
             [(title, 18, True, INK, 12), (body, 14, False, MUTED, 0)])
        x += col + Inches(0.42)

    text(s, MARGIN, Inches(6.05), Inches(11.6), Inches(0.8),
         [("Safety flags are the deliberate exception — a disclosure cannot wait for a third "
           "response, so the app says one exists and warns you that opening it may identify the author.",
           14, False, INK, 0)])
    footer(s, 15)
    notes(s, "Expect this question. The receipt/response separation is the whole design, and the "
             "three-response threshold is the honest acknowledgement of the maths.")


def slide_admin():
    s = blank()
    eyebrow(s, "Database administration")
    heading(s, "Accounts your detachment controls",
            "Create cadets one at a time or import a class by CSV — passwords are generated and handed to you once.")
    picture(s, "admin.png", MARGIN, Inches(2.65), Inches(11.6), Inches(3.9))
    footer(s, 16)
    notes(s, "Mention the credentials list can only be read once, because only hashes are stored. "
             "Download it, distribute it, delete it.")


def slide_start():
    s = blank()
    fill(s, NAVY)
    text(s, MARGIN, Inches(1.15), Inches(10), Inches(1.0), [("Getting started", 44, True, WHITE, 0)])
    steps = [
        ("1", "Create the folder", "A Google account the detachment owns, and a folder named TOP-Feedback."),
        ("2", "Register the app", "One free Google Cloud project so the app can reach that Drive. About ten minutes."),
        ("3", "Run the wizard", "Paste the folder link, create your administrator account, add cadets."),
    ]
    y = Inches(2.5)
    for num, title, body in steps:
        circ = s.shapes.add_shape(MSO_SHAPE.OVAL, MARGIN, y, Inches(0.62), Inches(0.62))
        circ.fill.solid(); circ.fill.fore_color.rgb = WHITE
        circ.line.fill.background(); circ.shadow.inherit = False
        p = circ.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = num
        r.font.size = Pt(20); r.font.bold = True; r.font.color.rgb = NAVY
        text(s, MARGIN + Inches(1.0), y + Inches(0.02), Inches(9.5), Inches(1.0),
             [(title, 22, True, WHITE, 5), (body, 15, False, WHITE, 0)])
        y += Inches(1.25)

    rect(s, MARGIN, Inches(6.35), Inches(11.6), Emu(19050), WHITE)
    text(s, MARGIN, Inches(6.6), Inches(11.6), Inches(0.5),
         [("The full step-by-step is in the Installation and Setup Guide.", 15, False, WHITE, 0)])
    notes(s, "Close here. Point at the setup guide PDF for anyone who will actually do the install.")


for fn in [slide_title, slide_problem, slide_what, slide_data, slide_roles,
           slide_student_list, slide_scale, slide_mobile, slide_portal, slide_create,
           slide_ratings, slide_split, slide_written, slide_safety, slide_anonymity,
           slide_admin, slide_start]:
    fn()

OUT.parent.mkdir(parents=True, exist_ok=True)
prs.save(str(OUT))
print(f"{len(prs.slides._sldIdLst)} slides written to {OUT}")
