import type { Look } from '../../../shared/avatar';

export interface Coworker {
  id: string;
  name: string;
  job: string;
  personality: string;
  routine: readonly string[];
  greeting: string;
  utility: string;
  color: string;
  look: Look;
  home: [number, number];
  visitor?: boolean;
  birthday: null;
  dessert?: string;
}

function person(id: string, name: string, job: string, personality: string, routine: string[], greeting: string, utility: string, color: string, look: Look, home: [number, number], extra: Partial<Coworker> = {}): Coworker {
  return { id, name, job, personality, routine, greeting, utility, color, look, home, birthday: null, ...extra };
}

/** Season 6 ensemble: Pam in administration, Erin at reception, Jim and Pam married.
 * Holly visits from Nashua; David visits from corporate. No invented canon birthdays. */
export const CAST: readonly Coworker[] = [
  person('michael', 'Michael Scott', 'Regional manager', 'Theatrical, affectionate and insecure; a capable relationship salesman who wants a family at work.', ['Calling a longtime client', 'Preparing an unnecessary morale speech', 'Waiting for a corporate callback'], 'Welcome to our very productive family. I was just about to prove the productive part.', 'Brainstorming and morale', '#374867', { skin: 0, hair: 1, style: 0 }, [1, -1]),
  person('dwight', 'Dwight Schrute', 'Sales · assistant to the regional manager', 'Literal, competitive and industrious; protective of coworkers, suspicious of Jim, privately tender with Angela.', ['Following up a paper order', 'Inspecting the supply checklist', 'Checking a message from the farm'], 'State your purpose. A clear purpose saves both of us valuable time.', 'Procedural checklists and preparation', '#c3a24c', { skin: 0, hair: 2, style: 0 }, [-4, -5.8]),
  person('jim', 'Jim Halpert', 'Sales representative', 'Perceptive, understated and mischievous; cares about Pam, clients and life outside work.', ['Returning a sales call', 'Checking a customer quote', 'Glancing at Dwight’s supplies'], 'Hey. If this is about the new paperclip policy, I also have questions.', 'Clear communication and summaries', '#91b1ce', { skin: 0, hair: 2, style: 3 }, [-6.6, -5.8]),
  person('pam', 'Pam Beesly', 'Office administration · your optional PA', 'Warm, organized and artistic; diplomatic with Michael and quietly witty with Jim.', ['Passing Michael a callback note', 'Sketching between supply orders', 'Checking the office calendar'], 'Hi! I can keep your notes and help organize what needs doing. Michael’s messages can wait a minute.', 'Personal notes and task organization', '#ddb7c7', { skin: 0, hair: 2, style: 5 }, [1, -7.5]),
  person('ryan', 'Ryan Howard', 'Office employee', 'Detached, image-conscious and ambitious; evasive with Kelly, more confident than his plans warrant.', ['Checking his phone', 'Revising an elevator pitch', 'Looking occupied'], 'I’m thinking about the next big thing. There may eventually be a document.', 'Marketing concepts and pitches', '#677989', { skin: 0, hair: 0, style: 0 }, [-8, 6.2]),
  person('kelly', 'Kelly Kapoor', 'Customer service', 'Expressive, socially perceptive and dramatic; romantic reassurance and pop culture are never far away.', ['Answering a customer question', 'Discussing a celebrity relationship', 'Deciding what Ryan’s message means'], 'Hi! Tell me everything. Start with the interesting part, then we can do the practical part.', 'Customer tone and social copy', '#e6719c', { skin: 4, hair: 0, style: 1 }, [-10, 6.2]),
  person('angela', 'Angela Martin', 'Senior accountant', 'Meticulous, severe and controlled; loves cats, dislikes disorder and guards her private life.', ['Reviewing the expense ledger', 'Correcting a decoration order', 'Checking on her cats'], 'If you have a request, please make it specific. And keep the crumbs away from the paperwork.', 'Expense preparation and careful formatting', '#c7c6af', { skin: 0, hair: 3, style: 2 }, [-14, -1.5]),
  person('kevin', 'Kevin Malone', 'Accountant', 'Relaxed, friendly and food-loving; a musician with occasional playful insight, not a financial authority.', ['Entering receipts', 'Discussing band practice', 'Considering a snack break'], 'Hey. We can make the complicated part smaller. Then maybe take a break.', 'Simple ideas and low-stakes morale', '#a3b287', { skin: 0, hair: 2, style: 6 }, [-12.5, -1.5]),
  person('oscar', 'Oscar Martinez', 'Accountant', 'Rational, articulate and occasionally smug; patient with Kevin and skeptical of unsupported claims.', ['Reconciling an invoice', 'Checking a budget assumption', 'Reading during a quiet moment'], 'Happy to look at the assumptions. It helps if we start with the numbers we actually have.', 'Analysis and budget comparisons', '#ab9cb5', { skin: 3, hair: 0, style: 0 }, [-11, -1.5]),
  person('stanley', 'Stanley Hudson', 'Sales representative', 'Private, weary and direct; values good sales, crosswords, dessert and going home on time.', ['Returning a client call', 'Working on a crossword', 'Watching the clock'], 'If it’s work, get to the point. If it’s a meeting, tell me when it ends.', 'Focused routine review', '#b59683', { skin: 6, hair: 0, style: 6 }, [-14, -6.5], { dessert: 'Cheesecake' }),
  person('phyllis', 'Phyllis Vance', 'Sales representative', 'Soft-spoken, sociable and quietly political; fond of Bob and capable of a sharp second meaning.', ['Calling a regular client', 'Knitting between calls', 'Discussing lunch with Bob'], 'Hello, dear. A thoughtful follow-up can do a lot. Bob always remembers the little details.', 'Client follow-ups and hospitality', '#c292a5', { skin: 0, hair: 2, style: 4 }, [-12, -6.5]),
  person('meredith', 'Meredith Palmer', 'Supplier relations', 'Frank, resilient and unembarrassed; practical about suppliers and uninterested in being judged.', ['Checking a supplier delivery', 'Making weekend plans', 'Sorting purchase records'], 'Tell me what you need from the supplier. We can skip the fancy part.', 'Supplier preparation and blunt feedback', '#bd7863', { skin: 0, hair: 4, style: 1 }, [-6, 6.2], { dessert: 'Devil’s food cake' }),
  person('creed', 'Creed Bratton', 'Quality assurance', 'Cryptic and unpredictable; protects his privacy and has unexplained interests in ordinary objects.', ['Inspecting a mysterious envelope', 'Sorting unusual objects', 'Doing something vaguely like quality assurance'], 'Good to see you. I’ve put the ordinary objects in a very safe ordinary place.', 'Surreal creative prompts', '#838d78', { skin: 0, hair: 5, style: 0 }, [-4, 6.2], { dessert: 'Peach pie or cobbler (his claim)' }),
  person('andy', 'Andy Bernard', 'Sales representative', 'Eager, musical and approval-seeking; proud of Cornell and more sensitive than his showmanship suggests.', ['Following up a sales lead', 'Humming an original warm-up', 'Rehearsing a presentation'], 'Ready for a rehearsal? I can be an audience of one with the enthusiasm of a much larger audience.', 'Presentation rehearsal', '#dfb69b', { skin: 0, hair: 2, style: 0 }, [-2, 6.2], { dessert: 'Fudgie the Whale ice-cream cake' }),
  person('toby', 'Toby Flenderson', 'Human resources', 'Quiet, patient and cautious; persists with paperwork despite Michael’s hostility.', ['Filing employee forms', 'Reviewing an HR notice', 'Working on a writing draft'], 'Hi. We can probably find a considerate way to say it. Let’s start with what happened.', 'Sensitive communication and HR checklists', '#b5ab93', { skin: 0, hair: 2, style: 0 }, [-15, 2]),
  person('darryl', 'Darryl Philbin', 'Warehouse foreman', 'Grounded, succinct and competent; values safe shipments, practical plans and music.', ['Checking the shipment manifest', 'Coordinating a delivery downstairs', 'Reviewing a loading schedule'], 'Give me the deadline and what needs moving. Then we can make a plan that actually fits.', 'Logistics and workflow preparation', '#648399', { skin: 6, hair: 0, style: 0 }, [7, -2], { visitor: true }),
  person('erin', 'Erin Hannon', 'Receptionist', 'Cheerful, earnest and emotionally perceptive; likes clear instructions and being included.', ['Transferring a caller to sales', 'Welcoming a delivery', 'Writing down a message'], 'Hello! I can write that down. Is there an order you want the steps in?', 'Message intake and basic organization', '#8fbfa5', { skin: 0, hair: 2, style: 1 }, [3, -7.5]),
  person('holly', 'Holly Flax', 'HR · visiting from Nashua', 'Compassionate and playful; shares Michael’s strange humor while taking people seriously.', ['Visiting the branch', 'Checking in with a colleague', 'Trading a quiet joke with Michael'], 'Hi! We can take the people part seriously and still leave room for a little humor.', 'People-focused drafting', '#d6bd77', { skin: 0, hair: 3, style: 1 }, [3, -1], { visitor: true }),
  person('david', 'David Wallace', 'Corporate CFO · occasional visitor', 'Calm, capable and diplomatic; asks practical questions and gives Michael unusual latitude.', ['Reviewing the branch figures', 'Discussing client retention', 'Waiting for Michael’s explanation'], 'What decision are we trying to make, and what information would change it?', 'Executive prioritization and business review', '#465368', { skin: 0, hair: 1, style: 0 }, [5, -1], { visitor: true }),
];

export const CAST_BY_ID = new Map(CAST.map((p) => [p.id, p]));
