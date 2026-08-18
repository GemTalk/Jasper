Feature: Connecting from the manager

  Connecting is what the screen is usually opened to do, so it leads the page.
  Every login is listed with the user and stone it reaches, and logging in
  happens where the login is listed rather than in a separate view. A login whose
  stone the manager cannot see running is offered the button that starts it
  first — which starts only what is actually down, so it is the safe thing to
  reach for either way.

  Scenario: Log in to a database
    Given the GemStone Manager is open
    Then DataCurator is listed under Connect
    When I start DataCurator's stone and log in
    Then the manager offers to log DataCurator out again
    And the session it opened is the one the editor works in
