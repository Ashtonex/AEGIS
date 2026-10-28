"""Controlled e-GP page fixtures.

The markup skeleton mirrors the live PRAZ e-GP portal as captured on
2026-10-26 (Bulletin Board table, pagination summary, notice-page label
layout, signed-out shell). The notices themselves are fictional so tests
are repeatable and no portal content is redistributed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import escape
from typing import Optional

BASE = "https://egp.praz.org.zw"


@dataclass
class Notice:
    notice_id: str
    reference: str
    title: str
    entity: str = "MUTARE CITY COUNCIL"
    codes: str = "SC006"
    names: str = "Construction and Civil Works (buildings, dams, roads etc.) (New)"
    board_status: str = "Open"
    published: str = "20-Oct-2026 09:00 AM"
    closing: str = "20-Nov-2026 10:00 AM"
    # Notice page only
    status: str = "Published"
    method: str = "Open Domestic Bidding"
    procurement_class: str = "Works"
    location: str = "Sakubva, Mutare"
    description: str = "Rehabilitation of 4.2 km of urban road including drainage and culverts."
    bid_validity: str = "90"
    delivery_period: str = "180 Day(s)"
    fee: str = "50"
    addenda: str = "0"
    downloads: str = "12"
    detail_closing: Optional[str] = None  # None -> same as list
    extra: dict = field(default_factory=dict)


def bulletin_page(notices: list[Notice], *, page: int = 1, pages: int = 1, total: Optional[int] = None,
                  summary: bool = True, clock: str = "2026/10/26 14:10:28") -> str:
    rows = "".join(f"""
        <tr>
          <td data-label="Tender Id"><u class="spelling"><a href="{BASE}/Indexes/viewLiveTenderDetails/{n.notice_id}">{n.notice_id}</a></u></td>
          <td data-label="Control Number" style="text-align:left !important;"><span class="wrapped-long-string">{escape(n.reference)} </span></td>
          <td data-label="Tender Reference Number" style="text-align:left !important;"><span class="wrapped-long-string">{escape(n.title)} </span></td>
          <td data-label="Required Supplier Categories Code" style="text-align:left !important;"><span>{escape(n.codes)} </span></td>
          <td data-label="Required Supplier Categories Name" style="text-align:left !important;"><span class="wrapped-long-string">{escape(n.names)} </span></td>
          <td data-label="Procuring Entity" style="text-align:left !important;"><span>{escape(n.entity)} </span></td>
          <td data-label="Procuring Entity" style="text-align:left !important;"><span>{escape(n.board_status)}</span></td>
          <td data-label="Publish Date"><span>{n.published} </span></td>
          <td data-label="Closing date"><span>{n.closing}</span></td>
        </tr>""" for n in notices)
    nav = ""
    if summary:
        nxt = (f'<li class="next"><a rel="next" href="/index?url=Indexes%2Findex&amp;page={page + 1}&amp;direction=BulletinBoardLive.id">next &gt;</a></li>'
               if page < pages else "")
        nav = f'<ul class="pagination">{nxt}</ul><p>Page {page} of {pages}, showing {len(notices)} record(s) out of {total if total is not None else len(notices)} total</p>'
    return f"""<!DOCTYPE html><html><head><script>var dt = '{clock}';</script></head><body>
    <form name="frmSearch" id="frmSearch" method="GET" action="{BASE}/Indexes/index"></form>
    <div class="tab-content"><div class="responsive-card-table">
    <table class="table table-bordered table-hover text-center"><thead><tr>
      <th scope="col">Tender Id</th><th scope="col">Tender Reference Number</th><th scope="col">Tender Title</th>
      <th scope="col">Required Supplier Category Code</th><th scope="col">Required Supplier Category Name</th>
      <th scope="col">Procuring Entity</th><th scope="col">Scope</th><th scope="col">Publish Date</th><th scope="col">Closing Date</th>
    </tr></thead>{rows}</table>{nav}</div></div></body></html>"""


def notice_page(n: Notice, *, clock: str = "2026/10/26 14:10:33") -> str:
    closing = n.detail_closing if n.detail_closing is not None else n.closing
    closing_html = f"<label>Closing Date:</label></br>  {closing} </br></br>" if closing else ""
    return f"""<!DOCTYPE html><html><head><script>var dt = '{clock}';</script></head><body>
    <section class="content"><div id="block_content" class="box-body">
      <div class="col-xs-12 headerFont">
        <div class="col-sm-9"><label>Tender Id :{n.notice_id}</label></div>
        <div class="col-sm-3"><label>Status :</label>&nbsp;
          {escape(n.status)}</div>
      </div>
      <div class="col-xs-12">
        <div class="col-sm-3 tamoha_twelvepx">
          <label>Bid Validity Period (in Days): </label></br>{n.bid_validity}</br></br>
          <label>Tender Reference Number: </label></br>{escape(n.reference)}</br></br>
          <label>Lot Type: </label></br>Single Lot</br></br>
          <!--<label>Approved Budget of the Contract: </label></br>
          999999</br></br>
          -->
          <label>Procurement Method: </label></br>{escape(n.method)}</br></br>
          <label>Class of Procurement: </label></br>{escape(n.procurement_class)}</br></br>
          <label>Delivery/Project Location: </label></br>{escape(n.location)}</br></br>
          <label>Required Supplier Categories: </label></br>{escape(n.names)}</br></br>
          <label>Delivery Period: </label></br>{escape(n.delivery_period)}</br></br>
          <label>Procuring Entity: </label></br>{escape(n.entity)}</br></br>
          <!--label>Contact Person: </label></br>Not Published</br></br-->
        </div>
        <div class="col-sm-6">
          <b><center class="verdhana_twelvepx">{escape(n.entity)} </center></b>
          <center class="verdhana_twelvepx">Civic Centre, Herbert Chitepo Street</center>
          <center class="verdhana_fourteenpx"><b><div class="wrapped-long-string">{escape(n.title)}</b></div></center>
          <table class="table table-bordered table-striped">
            <tr><td width="100%"><b>Project Name:</b> </br>{escape(n.title)}</td></tr>
            <tr><td><b>Description:</b></br><div><p>{escape(n.description)}</p></div></td></tr>
          </table>
          <table class="table table-bordered table-striped fixed_header">
            <tr><th>Item No.</th><th>UNSPSC</th><th>Lot Name</th><th>Lot Description</th><th>Quantity</th><th>Unit of Measure</th></tr>
            <tr><td>1</td><td>72141100</td><td>Road works</td><td>{escape(n.description)}</td><td>1</td><td>Lot</td></tr>
          </table>
        </div>
        <div class="col-sm-3 tamoha_twelvepx">
          <div style="display:none;"><label>BAC Members: </label>&nbsp; Hidden Person </br></div>
          <label>Schedule of activity: </label>&nbsp; <a rel="facebox" href_path="/Tenders/tender_shedule/{n.notice_id}" class="button">View all activity</a> </br>
          <label>Published Date: </label></br>{n.published}  </br></br>
          {closing_html}
          <label>Date Last updated:</label></br>  21-Oct-2026 08:00 AM  </br></br>
          <label>Documents:</label>&nbsp;  <a rel="facebox" href_path="/Tenders/tender_doc_view/{n.notice_id}/{n.notice_id}" class="button">Preview</a> </br></br>
          <label>Bid Form Fee: </label></br>  {n.fee}&nbsp;  </br></br>
          <label>Tender Addendums: </label>&nbsp; <a href="#" class="button">{n.addenda}</a></br>
          <label>Number of Downloads: </label>&nbsp; {n.downloads} </br>
        </div>
      </div>
    </div></section></body></html>"""


def login_shell() -> str:
    return """<!DOCTYPE html><html><body><a href="/pendingTasks/pendingTaskGrid">eGP System</a>
    <div>User Session Expiring!</div><div>Your session has been expired,
    please login in again to continue.</div></body></html>"""


def captcha_page() -> str:
    return '<html><body><div class="g-recaptcha" data-sitekey="x"></div></body></html>'


ROAD_MUTARE = Notice("900001", "MCC/RD/01/2026", "REHABILITATION OF SAKUBVA ROADS AND STORMWATER DRAINS")
CULVERT_NYANGA = Notice("900002", "NRDC/CW/07/2026", "CONSTRUCTION OF BOX CULVERT AND DRIFT AT NYAMAROPA",
                        entity="NYANGA RURAL DISTRICT COUNCIL", location="Nyamaropa, Nyanga")
STATIONERY = Notice("900003", "MOH/GDS/22/2026", "SUPPLY AND DELIVERY OF STATIONERY", entity="MINISTRY OF HEALTH",
                    codes="GS001", names="Stationery and Office Consumables", location="Harare")
BULAWAYO_ROADS = Notice("900004", "BCC/RD/11/2026", "RESURFACING OF CITY ROADS", entity="BULAWAYO CITY COUNCIL",
                        location="Bulawayo CBD")
CONSULTANCY = Notice("900005", "ZINARA/C/02/2026", "CONSULTANCY FOR ROAD CONDITION SURVEY", entity="ZINARA",
                     codes="SE001", names="Engineering Consultancy", location="Nationwide")
