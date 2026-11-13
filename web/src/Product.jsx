// The page signed-out visitors see at the root of the app's address.
const REPO = 'https://github.com/bond-bit0/amelia-money'

function Phone({ src, alt }) {
  return <div className="pp-phone"><img src={src} alt={alt} loading="lazy" /></div>
}

function Feature({ tag, title, text, points, src, alt, flip }) {
  return (
    <section className={`pp-feature${flip ? ' flip' : ''}`}>
      <div>
        <span className="pp-tag">{tag}</span>
        <h2>{title}</h2>
        <p>{text}</p>
        <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
      <Phone src={src} alt={alt} />
    </section>
  )
}

export function Product() {
  return (
    <div className="pp">
      <nav className="pp-nav">
        <span className="brand"><span className="pp-coin">$</span>Amelia Money</span>
        <a className="btn" href={REPO}>Get the code</a>
        <a className="btn primary" href="/login">Sign in</a>
      </nav>

      <header className="pp-hero">
        <div>
          <h1>Kids earn it. Kids track it. Parents stay in charge.</h1>
          <p>Amelia Money is a family money app. Kids claim jobs, watch their balance grow, ask before they spend, and pay back loans on a schedule. It teaches how money works by letting them use it.</p>
          <div className="pp-cta">
            <a className="btn primary" href="/login">Sign in</a>
            <a className="btn" href={REPO}>Set it up for your family</a>
          </div>
        </div>
        <Phone src="/shots/kid-home.png" alt="A kid's home screen with Credit, Available and a list of jobs to claim" />
      </header>

      <Feature tag="Earning" title="Jobs pay the moment they are done"
        text="Parents set the jobs and the prices. Kids tap Claim and the money lands right away. No waiting on a parent to remember."
        points={['Limits stop double claims, like once every 2 days or 2 a day.', 'One-time tasks count down and expire if nobody claims them.', 'Both parents get a phone alert on every claim and can undo it with a note.']}
        src="/shots/kid-jobs.png" alt="Jobs list with Claim buttons and a task that ends in 2 hours" />

      <Feature flip tag="Spending" title="Kids ask. Parents say yes or no."
        text="Credit is everything a kid owns. Available is what they can spend today. To buy something, they send a request and a parent answers with 1 tap."
        points={['Requests cover purchases, cash, gifts and money from a kid business.', 'Parents can log a purchase themselves at the store.', 'A no comes back with the reason.']}
        src="/shots/parent-home.png" alt="A parent's home screen with a purchase request waiting for Approve or Say no" />

      <Feature tag="Borrowing" title="Loans that work like real loans"
        text="A parent lends money for something big. The app builds the payment schedule and tracks every payment against its due date."
        points={['Weekly, every 2 weeks or monthly payments, with or without interest.', 'A missed payment is a strike. At the limit, the item can be repossessed.', 'A chart shows the plan next to what really happened.', 'Money for the next payment is held back from Available.']}
        src="/shots/kid-loan.png" alt="Loan screen showing left to pay, on-time count, next payment and a balance chart" />

      <Feature flip tag="Records" title="Every dollar has a line"
        text="Nothing is edited or deleted. A mistake is fixed with a new line that reverses it, the way a bank does it."
        points={['Filter by earned, received, spent, loan and fixes.', 'See who approved each line and when.', 'Parents can download everything as a spreadsheet.']}
        src="/shots/kid-activity.png" alt="Activity list with jobs, gifts, purchases and loan payments" />

      <h2 className="pp-section-title">Built for real family life</h2>
      <div className="pp-grid">
        <div className="card"><h3>Installs like an app</h3><p className="muted">Add it to an Android or iPhone Home screen. No app store.</p></div>
        <div className="card"><h3>Phone alerts</h3><p className="muted">Claims, requests and due dates reach the right person.</p></div>
        <div className="card"><h3>2 parents, 1 view</h3><p className="muted">Both parents see the same numbers and either one can approve.</p></div>
        <div className="card"><h3>More than 1 kid</h3><p className="muted">Each child gets a login, a balance and their own loans.</p></div>
        <div className="card"><h3>No bank needed</h3><p className="muted">The app keeps score. Parents hold the money.</p></div>
        <div className="card"><h3>Private by design</h3><p className="muted">A family only ever sees its own data.</p></div>
      </div>

      <section className="pp-own">
        <h2>Free for your family</h2>
        <p>The code is open source under the MIT license. Run your own copy on free Supabase and Netlify plans. The setup guide takes 5 steps.</p>
        <a className="btn" href={REPO}>Get the code on GitHub</a>
      </section>

      <footer className="pp-foot">
        <p>Screens show demo data. Part of <a href="https://www.ameliabond.online">Amelia Bond's Online Portal</a>.</p>
      </footer>
    </div>
  )
}
