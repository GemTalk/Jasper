Feature: Creating a project

  You don't need a stone to start. Turn an empty folder into a project on disk,
  open one someone else wrote and read its packages straight from the source, or
  put a new project under version control like any other tree of files.

  Scenario: Turn an empty folder into a project
    Given an empty folder is open
    When I create a Rowan project
    Then the folder becomes a Rowan project

  @fixture:demo-library
  Scenario: See the project and its packages
    Given the demo-library Rowan project is open
    When I open the This Project view
    Then it lists the DemoLibrary-Core package

  Scenario: Put a new project under version control
    Given an empty folder is open
    When I create a Rowan project
    And I put the folder under version control
    Then the project's files are waiting to be committed
    When I commit them with a message
    Then nothing is left to commit
