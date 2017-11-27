/*
   Zendesk Roulette - Rob Baker
   
   Parts of Code Copyright (c) 2013 by BetterCloud, Micheal Stone - ALL RIGHTS RESERVED
   *** NOT FOR DISTRIBUTION ***
   
   Rob Baker changes
     * Added Properties so that each function could be called independently
     * Added a main function so script can be manually run
     * Added search filter changes to limit results to only tags of interest and oldest tickets first
       to avoid hitting script processing time limits 
     * Limited assignment to a maximum of 10 tickets per pass to avoid the entire queue from being assigned at once
     * Fixed an issue where the last agent assigned would continue to be pushed tickets if there were no active agents
       including the previously assigned agent

   Variables that need to be populated prior to use
     * [YourSheetID]
     * [YourSubDomain]
     * [YourUserName]
     * [YourToken] 
     * [YourTags]

  For more information please refer to the Zendesk Community Thread at: 
    https://support.zendesk.com/hc/en-us/community/posts/203458976-Round-robin-ticket-assignment
   
*/

function makeAssignments()
{

  //DEBUG//
  Logger.log("Entered in to makeAssignments");
  //DEBUG//
  
  //Pull in Properties
  var mcpSheetIdProperty = PropertiesService.getScriptProperties().getProperty('mcpSheetId');
  var maxRangeProperty = PropertiesService.getScriptProperties().getProperty('maxRange');
  var verboseLoggingProperty = PropertiesService.getScriptProperties().getProperty('verboseLogging');
  var subdomainProperty = PropertiesService.getScriptProperties().getProperty('subdomain');
  var userNameProperty = PropertiesService.getScriptProperties().getProperty('userName');
  var tokenProperty = PropertiesService.getScriptProperties().getProperty('token');

  // Initialize Variables and Sheet References
  var maxRange = maxRangeProperty; // starts at column 5 goes out to 10 (5 possible formtype columns) (IMPORTANT: Look at line 215 (col J range)
  var verboseLogging = verboseLoggingProperty; // set to true for minute-by-minute logging
  var mcpSheetId = mcpSheetIdProperty;
  var subdomain = subdomainProperty;
  var userName = userNameProperty;
  var token = tokenProperty;
  var supportTable = SpreadsheetApp.openById(mcpSheetIdProperty);
  var agentSheet   = supportTable.getSheetByName("Support Agents");
  var logSheet     = supportTable.getSheetByName("Assignment Log");
  var debugSheet   = supportTable.getSheetByName("Debug Log");
  
  //DEBUG//
  Logger.log("maxRange: " + maxRange);
  //DEBUG//
  

  // get the agents into an array
  var aAgentQueue = agentSheet.getRange("A2:G").getValues();
  
  // get the unassigned (recent) ticket list using search api
  var searchTickets = seekOpenTickets(subdomain, userName, token);
  
  var results = Utilities.jsonParse(searchTickets);
  
  //DEBUG//
  //debugSheet.insertRowBefore(2);
  debugSheet.getRange("A2").setValue(results.results);
  //DEBUG//
      
  //for (var i = 0; i < results.results.length; i++)
  //Change to only assign a max of 10 tickets per pass
  var j = results.results.length;
  if (j > 10) {
    j = 10;
  }
  for (var i = 0; i < j; i++)
  {
    
    var ticketID = results.results[i].id;
    var tags = results.results[i].tags.toString();
    var assigneeID = results.results[i].assignee_id;
    
    // update log table
    if (verboseLogging == true)
    {
      logSheet.insertRowBefore(2);
      logSheet.getRange("A2").setValue(Date());
      logSheet.getRange("B2").setValue(ticketID);
      if (assigneeID != null)
      {
        logSheet.getRange("C2").setValue(assigneeID);
      }
      logSheet.getRange("D2").setValue(tags);
    }
    
    if (assigneeID == null)
    {

      if (verboseLogging == true)
      {
        // ???
      } else {
        logSheet.insertRowBefore(2);
        logSheet.getRange("A2").setValue(Date());
        logSheet.getRange("B2").setValue(ticketID);
        logSheet.getRange("D2").setValue(tags);
      }
      logSheet.getRange("C2").setValue("Unassigned");
      
      // get form type
      var formType = parseFormType_(tags);
      // update log table
      logSheet.getRange("E2").setValue(formType);
      
      if (formType != "")
      {
      
        // get the currently available agent in the queue
        var agentAvailableItemNumber = seekNextAvailableAgentItem_(formType);
        if (agentAvailableItemNumber == -1) {
          //don't attempt to post if there are no available agents
          //DEBUG//
          Logger.log("No Active Agents, exiting script.");
          //DEBUG//
          return(-1);
        }
        var assigneeName = aAgentQueue[agentAvailableItemNumber][1];
        var agentUserID = aAgentQueue[agentAvailableItemNumber][2];
        var agentRowNumber = agentAvailableItemNumber + 2;

        // post the assignment
        if (postTicketAssignment_(subdomain, userName, token, ticketID, agentUserID) == true)
        {
          
          // update log sheet
          logSheet.getRange("G2").setValue(assigneeName);
          logSheet.getRange("H2").setValue(agentUserID);

          // clear the previous assignment status
          agentSheet.getRange("D2:D").clearContent();

          // set the assignment status for the current agent
          agentSheet.getRange("D" + agentRowNumber).setValue("x");
          // agentSheet.getRange("H" + agentRowNumber).setValue(ticketID); // already provided in new log file
          
          Logger.log("Assigned ticket ID " + ticketID + " to support agent " + aAgentQueue[agentAvailableItemNumber][1] + ".");

          // ticket assigned, update log sheet
          logSheet.getRange("F2").setValue("Ticket Assigned Automatically");
          
        } else {
          // web service post failed, no action taken for this ticket, update log sheet
          logSheet.getRange("F2").setValue("Zendesk API Post Failed");
        }
      } else {
        // not an assignable form type, no action taken for this ticket, update log sheet
        logSheet.getRange("F2").setValue("Not Valid Form Type");
      }
      
    } else {
      // assignee_id already filled, no action taken for this ticket, update log sheet
      // logSheet.getRange("F2").setValue("Ticket Already Assigned");
    }

  }
  
}

function getOpenTickets(subdomain, userName, token)
{

  token = userName + "/token:" + token;
  var encode = Utilities.base64Encode(token);

  var options =
      {
        "method" : "get",
        "headers" : 
        {
          "Content-type":"application/xml",
          "Authorization":  "Basic " + encode
        }
      };
  
  var result = UrlFetchApp.fetch("https://" + subdomain + ".zendesk.com/api/v2/tickets/recent.json tags:[YourTags] order_by:created sort:asc", options);
  
  return(result);

}

function seekOpenTickets(subdomain, userName, token)
{

  //DEBUG//
  Logger.log("Entered in to seekOpenTickets");
  Logger.log("Parameters: " + subdomain + ", " + userName + ", " + token); 
  //DEBUG//

  token = userName + "/token:" + token;
  var encode = Utilities.base64Encode(token);

  var options =
      {
        "method" : "get",
        "headers" : 
        {
          "Content-type":"application/xml",
          "Authorization":  "Basic " + encode
        }
      };
  
  // add additional filters to reduce the result set and execution time including tags and ordering by oldest first
  var result = UrlFetchApp.fetch("https://" + subdomain + ".zendesk.com/api/v2/search.json?query=type:ticket status:new assignee:none tags:draw_an_ace order_by:created sort:asc", options);
  
  return(result);

}

function postTicketAssignment_(subdomain, userName, token, ticketID, agentUserID)
{
  
  token = userName + "/token:" + token;
  var encode = Utilities.base64Encode(token);

  var payload =
      {
        "ticket":
        {
           "assignee_id" : parseInt(agentUserID)
        }
      };
  
  payload = JSON.stringify(payload);
  

  var options =
      {
        "method" : "put",
        "contentType" : "application/json",
        "headers" : 
        {
          "Authorization" :  "Basic " + encode
        },
        "payload" : payload
      };

  //DEBUG READ ONLY MODE//
  var result = UrlFetchApp.fetch("https://" + subdomain + ".zendesk.com/api/v2/tickets/" + ticketID + ".json", options);
  var ticket = Utilities.jsonParse(result);
  var assigneeID = ticket.ticket.assignee_id.toString();
  //var assigneeID = agentUserID;
  //DEBUG//
  
  // posted successfully?
  if (assigneeID == agentUserID)
  {
    return(true);
  } else {
    return(false);
  }

}

function seekNextAvailableAgentItem_(formType)
{

  //Pull in Properties
  var mcpSheetIdProperty = PropertiesService.getScriptProperties().getProperty('mcpSheetId');
  var maxRangeProperty = PropertiesService.getScriptProperties().getProperty('maxRange');
  var verboseLoggingProperty = PropertiesService.getScriptProperties().getProperty('verboseLogging');
  var subdomainProperty = PropertiesService.getScriptProperties().getProperty('subdomain');
  var userNameProperty = PropertiesService.getScriptProperties().getProperty('userName');
  var tokenProperty = PropertiesService.getScriptProperties().getProperty('token');

  // Initialize Variables and Sheet References
  var maxRange = maxRangeProperty; // starts at column 5 goes out to 10 (5 possible formtype columns) (IMPORTANT: Look at line 215 (col J range)
  var verboseLogging = verboseLoggingProperty; // set to true for minute-by-minute logging
  var mcpSheetId = mcpSheetIdProperty;
  var subdomain = subdomainProperty;
  var userName = userNameProperty;
  var token = tokenProperty;
  var supportTable = SpreadsheetApp.openById(mcpSheetIdProperty);
  var agentSheet   = supportTable.getSheetByName("Support Agents");
  var logSheet     = supportTable.getSheetByName("Assignment Log");
  var debugSheet   = supportTable.getSheetByName("Debug Log");
  
  //DEBUG//
  Logger.log("Entered in to seekAvailableAgentItem_");
  //DEBUG//
  
  // get the column number for the formType
  var formColumn = getFormColumn_(formType);
  Logger.log("Form Type: " + formType + "   Form column: " + formColumn);

  // get the agents into an array
  var aAgentQueue = agentSheet.getRange("A2:J").getValues(); // scoped to col J for a maxRange of 10, but needs to be updated if more than 12
  
  // locate the previous agent assigned
  var previouslyAssignedAgentItem = seekPreviouslyAssignedAgentItem_(aAgentQueue);
  Logger.log("Previously assigned agent item: " + previouslyAssignedAgentItem);
  
  // if the previously assigned agent is in the last row, start at the top and search for someone other than the previously assigned agent
  if ((previouslyAssignedAgentItem == aAgentQueue.length) || (previouslyAssignedAgentItem == 0))
  {
    // start at the top - find the next active agent
    for (var j = 0; j < aAgentQueue.length; j++)
    {
      if ((aAgentQueue[j][0] == "Yes") && (aAgentQueue[j][3] != "x") && (aAgentQueue[j][formColumn] == "x"))
      {
        return(j);
      }
    }
    return(previouslyAssignedAgentItem);
  } else {
    // see if any agents below the previously assigned agent are able to handle this form type
    // search to the bottom of the list
    for (var j = (previouslyAssignedAgentItem + 1); j < aAgentQueue.length; j++)
    {
      if ((aAgentQueue[j][0] == "Yes") && (aAgentQueue[j][3] != "x") && (aAgentQueue[j][formColumn] == "x"))
      {
        return(j);
      }
    }
    // if not found, start over at the top of the list
    for (var j = 0; j < aAgentQueue.length; j++)
    {
      if ((aAgentQueue[j][0] == "Yes") && (aAgentQueue[j][3] != "x") && (aAgentQueue[j][formColumn] == "x"))
      {
        return(j);
      }
    }
    // if nothing else found, stay on the current againt available
    //return(previouslyAssignedAgentItem);
    // this prevented ZDR from being turned off during non-business hours
    return(-1);
  }        
  //return(previouslyAssignedAgentItem);
  //this prevented ZDR from being turned off during non-business hours
  return(-1);
}

function seekPreviouslyAssignedAgentItem_(aAgentQueue)
{
  for (var i = 0; i < aAgentQueue.length; i++)
  {
    if (aAgentQueue[i][3] == "x")
    {
      return(i);
    }
  }
  return(0);
}

function parseFormType_(tags)
{
  
  //Pull in Properties
  var mcpSheetIdProperty = PropertiesService.getScriptProperties().getProperty('mcpSheetId');
  var maxRangeProperty = PropertiesService.getScriptProperties().getProperty('maxRange');
  var verboseLoggingProperty = PropertiesService.getScriptProperties().getProperty('verboseLogging');
  var subdomainProperty = PropertiesService.getScriptProperties().getProperty('subdomain');
  var userNameProperty = PropertiesService.getScriptProperties().getProperty('userName');
  var tokenProperty = PropertiesService.getScriptProperties().getProperty('token');

  // Initialize Variables and Sheet References
  var maxRange = maxRangeProperty; // starts at column 5 goes out to 10 (5 possible formtype columns) (IMPORTANT: Look at line 215 (col J range)
  var verboseLogging = verboseLoggingProperty; // set to true for minute-by-minute logging
  var mcpSheetId = mcpSheetIdProperty;
  var subdomain = subdomainProperty;
  var userName = userNameProperty;
  var token = tokenProperty;
  var supportTable = SpreadsheetApp.openById(mcpSheetIdProperty);
  var agentSheet   = supportTable.getSheetByName("Support Agents");
  var logSheet     = supportTable.getSheetByName("Assignment Log");
  var debugSheet   = supportTable.getSheetByName("Debug Log");
  
  //DEBUG//
  Logger.log("Entered in to parseFormType_");
  Logger.log("parseFormType:Tags:" + tags);
  //DEBUB//
  
  // determine the dynamic range
  for (var i = 5; i < maxRange; i++)
  {
    // Logger.log(agentSheet.getRange(1, i, 1, 1).getComment());
    if (agentSheet.getRange(1, i, 1, 1).getComment() == "")
    {
      var dynamicRangeMax = i - 5;
      i = maxRange; 
    }
  }
  
  // get dyanamic range into array
  var aFormTypes = agentSheet.getRange(1, 5, 1, dynamicRangeMax).getComments();
  
  //DEBUG//
  Logger.log("aFormTypes: " + aFormTypes.toString());
  Logger.log("Width: " + dynamicRangeMax);
  //DEBUG//
  
  // look at each form type column
  for (var i = 0; i < (dynamicRangeMax); i++)
  {
    // DEBUG //
    //Logger.log(i + ": " + aFormTypes[0][i]);
    // DEBUG //
    
    if (tags.toString().indexOf(aFormTypes[0][i]) > -1)
    {
      // DEBUG //
      Logger.log("Found FormType Match!  Returning " + aFormTypes[0][i]);
      // DEBUG //
      
      return(aFormTypes[0][i]);
    }
  }
  return("");
}

function testGetFormColumn()
{
  Logger.log(getFormColumn_("form_account"));
}

function getFormColumn_(formType)
{
  //Pull in Properties
  var mcpSheetIdProperty = PropertiesService.getScriptProperties().getProperty('mcpSheetId');
  var maxRangeProperty = PropertiesService.getScriptProperties().getProperty('maxRange');
  var verboseLoggingProperty = PropertiesService.getScriptProperties().getProperty('verboseLogging');
  var subdomainProperty = PropertiesService.getScriptProperties().getProperty('subdomain');
  var userNameProperty = PropertiesService.getScriptProperties().getProperty('userName');
  var tokenProperty = PropertiesService.getScriptProperties().getProperty('token');

  // Initialize Variables and Sheet References
  var maxRange = maxRangeProperty; // starts at column 5 goes out to 10 (5 possible formtype columns) (IMPORTANT: Look at line 215 (col J range)
  var verboseLogging = verboseLoggingProperty; // set to true for minute-by-minute logging
  var mcpSheetId = mcpSheetIdProperty;
  var subdomain = subdomainProperty;
  var userName = userNameProperty;
  var token = tokenProperty;
  var supportTable = SpreadsheetApp.openById(mcpSheetIdProperty);
  var agentSheet   = supportTable.getSheetByName("Support Agents");
  var logSheet     = supportTable.getSheetByName("Assignment Log");
  var debugSheet   = supportTable.getSheetByName("Debug Log");

  //DEBUG//
  Logger.log("Entered in to parseFormType_");
  Logger.log("maxRange:" + maxRange);
  //DEBUB//
  
  // determine the dynamic range
  for (var i = 5; i < maxRange; i++)
  {
    Logger.log("i:" + i + " :: " + agentSheet.getRange(1, i, 1, 1).getComment());
    if (agentSheet.getRange(1, i, 1, 1).getComment() == formType)
    {
      return(i-1);
    }
  }
  return(-1);  
}

function main() {

  //Set Global Properties
  PropertiesService.getScriptProperties().setProperty('mcpSheetId', '[YourSheetID]');
  PropertiesService.getScriptProperties().setProperty('maxRange', '10');
  PropertiesService.getScriptProperties().setProperty('verboseLogging', 'true');
  PropertiesService.getScriptProperties().setProperty('subdomain', '[YourSubDomain]');
  PropertiesService.getScriptProperties().setProperty('userName', '[YourUserName]');
  PropertiesService.getScriptProperties().setProperty('token', '[YourToken]');

  makeAssignments();
}
