# Customer Pilot Case Study

## Context

Before building OutcomeTrace, I ran two paid operational pilots with small food manufacturers. The pilots were delivered through Excel, Google Sheets, Python-assisted analysis, and manually managed workflows. They were not production software deployments.

The work is included here because it shaped how I approach forward-deployed AI systems: begin with the customer's operating reality, test the workflow with real users, and verify whether the final business outcome changed.

## Initial request

The customers initially described the problem as a need for better inventory and production tracking.

Their operations relied on a mix of:

- WhatsApp orders
- spreadsheets
- phone calls
- operator experience
- manually updated production and stock records

The visible symptoms were incomplete inventory visibility, rushed production, and inconsistent reporting.

## What discovery revealed

The main constraint was not reporting alone. The urgent daily decision was:

> What should we produce first today so we do not miss dispatch?

That decision depended on several connected factors:

- order deadlines
- finished-goods stock
- raw-material availability
- batch yields
- packaging availability
- procurement lead times
- production capacity
- machine sequencing

The customer had described a tracking problem. The operating workflow revealed a prioritization and execution problem.

## Pilot workflow

I designed and ran two paid pilot workflows covering:

- order consolidation
- SKU and bill-of-material mapping
- production prioritization
- batch-yield calculations
- procurement planning
- inventory monitoring
- packaging-cost allocation
- stockout and dispatch-risk identification

The pilots used existing customer inputs rather than requiring a clean new system. Data had to be reconciled across messages, spreadsheets, and manually maintained records.

## How the scope changed

The original concept covered a broad factory operations system. Customer feedback narrowed the product direction toward a dispatch-first planning layer.

The revised workflow prioritized:

1. what could ship from existing stock
2. which orders were at risk
3. what should be produced first
4. which materials or packaging could block dispatch
5. how the production sequence affected operating cost

This discovery became the foundation for BatchWatt, a dispatch-first production planning prototype for small food manufacturers.

## Connection to OutcomeTrace

The pilot also exposed a reliability problem that applies to AI agents.

A planning system can produce a convincing recommendation while still failing to improve the actual operating state. A useful evaluation therefore has to check more than the generated explanation. It should verify the resulting schedule, inventory state, dispatch risk, database record, or other measurable outcome.

That principle became OutcomeTrace's core rule:

> Evaluate agents by what they do, not what they say.

## What I learned

- Customers often describe the visible symptom rather than the binding operational constraint.
- Useful discovery requires following the work across people, messages, spreadsheets, and exceptions.
- The first technical scope is usually wrong or incomplete.
- A successful deployment should be judged by the resulting operating state, not by whether the interface or model response looks polished.
- Manual pilots can validate the workflow before a larger software build, but they should not be represented as production software deployments.

## Next technical step

The next version would connect:

- WhatsApp order ingestion
- stock-sheet synchronization
- persistent database storage
- production-plan generation
- dispatch outcome verification
- energy and peak-load analysis

OutcomeTrace can then evaluate whether the planning agent created the correct final state across repeated runs, rather than only reviewing its written recommendation.
