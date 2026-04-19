import type { MatchResult } from "./types";

// Days-ago helper so demo dates stay fresh regardless of when run.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const DEMO_MATCH: MatchResult = {
  repo_url: "https://github.com/acme/freight-graph",
  thesis: {
    moat:
      "Real-time graph-native routing layer for Indian road freight — combines GPS telematics with shipment-level intent to cut empty miles.",
    themes: [
      "Road freight telematics",
      "Route optimization",
      "SMB logistics SaaS",
      "India-first GTM",
    ],
    icp: {
      segment: "Mid-market fleet operators (50-500 trucks)",
      geographies: ["India", "Southeast Asia"],
      pain: "empty return loads, manual dispatch",
    },
    ideal_hire: {
      role: "Founding Engineer, Routing",
      skills: ["Rust", "graph algorithms", "OSRM", "Kafka"],
      seniority: "Senior / Staff",
    },
  },
  query_plan: [
    {
      endpoint: "/v1/people/search",
      track: "investor",
      payload: {
        filters: [
          { column: "current_company.industry", type: "(.)", value: "Venture Capital" },
          { column: "summary", type: "(.)", value: "logistics OR supply chain OR freight" },
          { column: "location.country", type: "=", value: "India" },
        ],
        page: 1,
      },
      rationale:
        "India-based VCs with logistics / supply-chain thesis — filter by partner-level title downstream.",
    },
    {
      endpoint: "/v1/company/search",
      track: "design_partner",
      payload: {
        filters: [
          { column: "industry", type: "(.)", value: "Trucking, Road freight, Logistics" },
          { column: "headcount", type: "range", value: [50, 500] },
          { column: "hq.country", type: "=", value: "India" },
        ],
      },
      rationale:
        "Mid-market Indian road-freight operators matching the ICP — the kind who will pilot a routing API.",
    },
    {
      endpoint: "/v1/people/search",
      track: "talent",
      payload: {
        filters: [
          { column: "skills", type: "(.)", value: "Rust, OSRM, graph, routing" },
          { column: "current_title", type: "(.)", value: "Staff OR Principal OR Founding" },
          { column: "location.city", type: "(.)", value: "Bengaluru OR Bangalore" },
        ],
      },
      rationale:
        "Senior routing/graph engineers in Bengaluru — co-located with founders, open to early-stage.",
    },
  ],
  investors: [
    {
      name: "Prayank Swaroop",
      title: "Partner",
      company: "Accel India",
      linkedin: "https://www.linkedin.com/in/prayank",
      recent_post:
        "Road freight in India is a $200B market still dispatched over WhatsApp. The next decade belongs to teams who treat the fleet like a graph, not a spreadsheet.",
      recent_post_url: "https://www.linkedin.com/posts/prayank-freight-graph",
      recent_post_date: daysAgo(3),
      geo_distance_km: null,
      score: 0.92,
      sub_scores: { thesis_fit: 0.95, recency: 0.9, stage_fit: 0.9 },
      warm_intro_draft:
        "Hi Prayank — saw your note last week on Indian freight still running on WhatsApp. We're building a graph-native routing layer that sits on top of fleet telematics and cuts empty return miles by ~18% in pilots with mid-market carriers. Seed-stage, 2 founders ex-Delhivery + ex-Uber Maps. Would love 20 mins this week. — Manu",
    },
    {
      name: "Piyush Kharbanda",
      title: "General Partner",
      company: "Peak XV Partners",
      linkedin: "https://www.linkedin.com/in/piyushk",
      recent_post:
        "Every logistics deck I see is about demand aggregation. The real unlock is on the supply side — the brokers, the small fleet owners, the 3 trucks a guy runs from his shed.",
      recent_post_url: "https://www.linkedin.com/posts/piyushk-supply-side",
      recent_post_date: daysAgo(6),
      geo_distance_km: null,
      score: 0.88,
      sub_scores: { thesis_fit: 0.9, recency: 0.85, stage_fit: 0.9 },
      warm_intro_draft:
        "Hi Piyush — completely agree with your supply-side take from last week. Our wedge is giving the 50-500 truck operators a dispatcher-in-a-box that plans the return load before the outbound even leaves. 3 paid pilots in Gujarat, LOI from Rivigo alum-ops. Open to a quick chat? — Manu",
    },
    {
      name: "Dev Khare",
      title: "Partner",
      company: "Lightspeed India",
      linkedin: "https://www.linkedin.com/in/devkhare",
      recent_post:
        "Interesting week at Auto Expo — the telematics vendors have won the hardware layer. The question now is who owns the decisions that sit on top of that data.",
      recent_post_url: "https://www.linkedin.com/posts/devkhare-telematics",
      recent_post_date: daysAgo(8),
      geo_distance_km: null,
      score: 0.85,
      sub_scores: { thesis_fit: 0.88, recency: 0.8, stage_fit: 0.87 },
      warm_intro_draft:
        "Hi Dev — your Auto Expo note on the decision layer on top of telematics maps exactly to what we're shipping. Open-source OSRM fork + a thin commercial planner for mid-market fleets. Happy to share the repo (8k stars, 40 orgs running it). — Manu",
    },
    {
      name: "Karthik Reddy",
      title: "Co-Founder & Partner",
      company: "Blume Ventures",
      linkedin: "https://www.linkedin.com/in/karthikreddy",
      recent_post:
        "Tier-2 manufacturing clusters are quietly becoming the most interesting customer base in SaaS. They pay, they don't churn, and nobody's selling to them with a modern stack.",
      recent_post_url: "https://www.linkedin.com/posts/karthikreddy-tier2",
      recent_post_date: daysAgo(10),
      geo_distance_km: null,
      score: 0.82,
      sub_scores: { thesis_fit: 0.82, recency: 0.75, stage_fit: 0.88 },
      warm_intro_draft:
        "Hi Karthik — tier-2 manufacturing is exactly who's paying us today. Hosur, Rajkot, Vapi clusters — they ship 40 loads a day and are thrilled to replace the dispatcher's notebook. Would love to walk you through the numbers. — Manu",
    },
    {
      name: "Anand Daniel",
      title: "Partner",
      company: "Accel India",
      linkedin: "https://www.linkedin.com/in/ananddaniel",
      recent_post:
        "Reading Simon Wardley again. The best infra companies pick a boring layer and make it 10x cheaper. Logistics has a dozen of those layers still waiting.",
      recent_post_url: "https://www.linkedin.com/posts/ananddaniel-wardley",
      recent_post_date: daysAgo(12),
      geo_distance_km: null,
      score: 0.8,
      sub_scores: { thesis_fit: 0.78, recency: 0.7, stage_fit: 0.92 },
      warm_intro_draft:
        "Hi Anand — routing is the boring layer. The incumbents charge per-call and lock you in; we're 10x cheaper self-hosted with a managed plane. Would value your read on our GTM. — Manu",
    },
  ],
  design_partners: [
    {
      name: "Sahil Barua",
      title: "CEO & Co-Founder",
      company: "Delhivery",
      linkedin: "https://www.linkedin.com/in/sahilbarua",
      recent_post:
        "The hardest problem in PTL is not the first mile or the last mile. It's the 47 decisions in between that nobody has a dashboard for.",
      recent_post_url: "https://www.linkedin.com/posts/sahilbarua-ptl",
      recent_post_date: daysAgo(2),
      geo_distance_km: 1240,
      score: 0.9,
      sub_scores: { icp_fit: 0.95, recency: 0.92, reachability: 0.8 },
      warm_intro_draft:
        "Hi Sahil — your note on the 47 middle-mile decisions is the exact surface we built for. We'd love to give Delhivery a 30-day pilot on a single lane pair (say Gurugram-Hosur) and show the empty-mile delta. Zero cost, we eat integration. — Manu",
    },
    {
      name: "Saahil Goel",
      title: "CEO & Co-Founder",
      company: "Shiprocket",
      linkedin: "https://www.linkedin.com/in/saahilgoel",
      recent_post:
        "Every D2C brand I talk to is trying to bring fulfillment in-house. Most will fail. The ones that succeed treat routing as a product decision, not an ops task.",
      recent_post_url: "https://www.linkedin.com/posts/saahilgoel-d2c",
      recent_post_date: daysAgo(4),
      geo_distance_km: 1800,
      score: 0.87,
      sub_scores: { icp_fit: 0.88, recency: 0.9, reachability: 0.83 },
      warm_intro_draft:
        "Hi Saahil — love the framing of routing as a product decision. We've built the planner layer that your D2C cohort could plug into without rebuilding their WMS. Happy to demo on one of your top-10 brands' lanes. — Manu",
    },
    {
      name: "Pranav Goel",
      title: "Co-Founder",
      company: "Porter",
      linkedin: "https://www.linkedin.com/in/pranavgoel",
      recent_post:
        "Mini-truck operators in Tier-2 India run at 40% empty km. The fix isn't a bigger marketplace — it's pre-planned return loads at the time of booking.",
      recent_post_url: "https://www.linkedin.com/posts/pranavgoel-emptykm",
      recent_post_date: daysAgo(5),
      geo_distance_km: 0,
      score: 0.86,
      sub_scores: { icp_fit: 0.9, recency: 0.88, reachability: 0.82 },
      warm_intro_draft:
        "Hi Pranav — we've been modeling exactly the Tier-2 empty-km problem you wrote about. We can ship Porter a return-load planner that slots in at booking-time, not dispatch-time. In Bengaluru all week — coffee? — Manu",
    },
    {
      name: "Deepak Garg",
      title: "Founder",
      company: "Rivigo",
      linkedin: "https://www.linkedin.com/in/deepakgarg",
      recent_post:
        "Driver relay was our biggest bet. What we learned: the relay works only when the graph of lane pairs is dense enough. Below a threshold, you're just running a worse OTR network.",
      recent_post_url: "https://www.linkedin.com/posts/deepakgarg-relay",
      recent_post_date: daysAgo(7),
      geo_distance_km: 1180,
      score: 0.83,
      sub_scores: { icp_fit: 0.8, recency: 0.82, reachability: 0.88 },
      warm_intro_draft:
        "Hi Deepak — your relay post hit home. We model lane-pair density as a first-class signal in the planner. Would value 30 mins of your scar tissue on the threshold question. — Manu",
    },
    {
      name: "Vidit Jain",
      title: "CEO & Co-Founder",
      company: "LocoNav",
      linkedin: "https://www.linkedin.com/in/viditjain",
      recent_post:
        "Telematics hardware is commoditized. The winners in the next cycle are the ones who turn the data stream into operator-facing decisions in under 200ms.",
      recent_post_url: "https://www.linkedin.com/posts/viditjain-200ms",
      recent_post_date: daysAgo(9),
      geo_distance_km: 1880,
      score: 0.81,
      sub_scores: { icp_fit: 0.82, recency: 0.78, reachability: 0.85 },
      warm_intro_draft:
        "Hi Vidit — we're the decision layer on top of exactly the kind of data LocoNav owns. P95 planner latency is 140ms today. A data-sharing pilot could be 1+1=3 for both sides. Open to explore? — Manu",
    },
  ],
  talent: [
    {
      name: "Aakash Mehta",
      title: "Staff Engineer, Maps",
      company: "Uber",
      linkedin: "https://www.linkedin.com/in/aakashmehta",
      recent_post:
        "Spent the weekend porting a chunk of OSRM internals to Rust. The performance headroom is silly — 3-4x on contraction hierarchies alone.",
      recent_post_url: "https://www.linkedin.com/posts/aakashmehta-osrm",
      recent_post_date: daysAgo(1),
      geo_distance_km: 4,
      score: 0.94,
      sub_scores: { skill_fit: 0.97, recency: 0.95, geo_fit: 0.95 },
      warm_intro_draft:
        "Hi Aakash — your OSRM-in-Rust post is basically our core repo's weekend roadmap. We're 2 engineers in Indiranagar, $2M seeded, hiring founding engineer #3 for routing. 4km from you. Want to grab filter coffee this week? — Manu",
    },
    {
      name: "Priya Subramanian",
      title: "Principal Engineer",
      company: "Google Maps",
      linkedin: "https://www.linkedin.com/in/priyas",
      recent_post:
        "Graph partitioning for continental road networks is one of those problems where the papers stop helping around 10M edges. After that you're on your own.",
      recent_post_url: "https://www.linkedin.com/posts/priyas-partitioning",
      recent_post_date: daysAgo(3),
      geo_distance_km: 7,
      score: 0.9,
      sub_scores: { skill_fit: 0.93, recency: 0.9, geo_fit: 0.9 },
      warm_intro_draft:
        "Hi Priya — we hit the 10M-edge wall on the India road graph three months ago and crawled out the other side with a custom METIS variant. Would love your eyes on it. 7km from you, founding-engineer role, equity-rich. — Manu",
    },
    {
      name: "Rohan Kapoor",
      title: "Senior Engineer, Dispatch",
      company: "Rapido",
      linkedin: "https://www.linkedin.com/in/rohankapoor",
      recent_post:
        "Dispatch systems are 10% algorithms and 90% observability. If you can't see why a driver got matched, you can't debug the matcher.",
      recent_post_url: "https://www.linkedin.com/posts/rohankapoor-observability",
      recent_post_date: daysAgo(5),
      geo_distance_km: 3,
      score: 0.87,
      sub_scores: { skill_fit: 0.88, recency: 0.85, geo_fit: 0.92 },
      warm_intro_draft:
        "Hi Rohan — your observability take is gospel for us. We ship a tracing UI with every routing decision. 3km from you, would love to show you the decision-log. Beer or chai, you pick. — Manu",
    },
    {
      name: "Ankit Verma",
      title: "Founding Engineer",
      company: "Locus.sh",
      linkedin: "https://www.linkedin.com/in/ankitv",
      recent_post:
        "Leaving Locus after 6 great years. Next: something early, something graph-shaped, something Indian. DMs open.",
      recent_post_url: "https://www.linkedin.com/posts/ankitv-leaving",
      recent_post_date: daysAgo(2),
      geo_distance_km: 6,
      score: 0.95,
      sub_scores: { skill_fit: 0.95, recency: 0.98, geo_fit: 0.92 },
      warm_intro_draft:
        "Hi Ankit — saw you're out of Locus and looking for something early, graph-shaped, Indian. That is literally us. 6km away, 2 founders, deep tech. Coffee this week? — Manu",
    },
    {
      name: "Neha Iyer",
      title: "Senior SRE, Platform",
      company: "Razorpay",
      linkedin: "https://www.linkedin.com/in/nehaiyer",
      recent_post:
        "Moved our Kafka clusters off managed and onto Strimzi on bare-metal last quarter. Saved 60% on spend, but the real win was being able to reason about tail latency again.",
      recent_post_url: "https://www.linkedin.com/posts/nehaiyer-strimzi",
      recent_post_date: daysAgo(11),
      geo_distance_km: 5,
      score: 0.82,
      sub_scores: { skill_fit: 0.8, recency: 0.75, geo_fit: 0.95 },
      warm_intro_draft:
        "Hi Neha — we're running Kafka in anger for real-time vehicle streams and about to hit the same managed-vs-Strimzi fork you crossed. Would love 30 mins of your scars. Hiring platform lead #1 if the story lands. — Manu",
    },
  ],
  stats: {
    profiles_scanned: 700_000_000,
    thesis_matches: 2_800,
    recent_signal: 180,
    track_fit: 42,
    ranked: 15,
    elapsed_ms: 11_420,
  },
};
