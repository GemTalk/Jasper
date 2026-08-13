Feature: One screen for the environment

  Everything Jasper knows about the GemStone environment on this machine is on a
  single screen: what the operating system still needs, which versions are
  installed, the databases made from them, and the logins that reach those
  databases. It opens like any other editor tab and keeps itself current, so it
  can be left open while the work it describes is going on.

  Scenario: See the whole environment at once
    When I open the GemStone Manager
    Then it has a "Connect" section
    And it has a "Databases" section
    And it has a "Versions" section
    And it has an "Operating System" section

  Scenario: Read what the operating system reports
    Given the GemStone Manager is open
    When I open the "Operating System" section
    Then shared memory is listed as a prerequisite
    And it says how much this machine has
