
insert into public.divisions(code,name,letter,freight_pct,packaging,rounding,target_margin,floor_margin,bulk_pct,bulk_min_qty,pricing_mode,sort) values
('TR','Trophies & Awards','T',5,20,10,45,30,10,25,'bands',1),
('AP','Apparel','A',4,15,10,40,25,12,15,'bands',2),
('IN','Infrastructure Material','I',6,0,1,25,15,5,500,'bands',3),
('SV','Services','S',0,0,5,70,50,20,25,'bands',4),
('EQ','Sports Equipment','E',4,10,10,30,18,8,10,'bands',5);

insert into public.types(div,code,name,letter,size_unit,uom,hsn,gst,is_service,margin_override) values
('TR','CUP','Cup Trophy','C','in','pcs','83062920',18,false,null),
('TR','FIG','Figure Trophy','F','in','pcs','83062920',18,false,null),
('TR','DIA','Diamond Trophy','D','in','pcs','70139900',18,false,50),
('TR','STR','Star Trophy','S','in','pcs','83062920',18,false,null),
('TR','COL','Tower Trophy','T','in','pcs','83062920',18,false,null),
('TR','MOM','Memento','E','in','pcs','39264049',18,false,null),
('TR','PLQ','Plaque','P','in','pcs','44209090',18,false,null),
('TR','SHD','Shield','H','in','pcs','83062920',18,false,null),
('TR','MED','Medal','M','mm','pcs','83062920',18,false,50),
('TR','RIB','Medal Ribbon','R','mm','pcs','58063200',18,false,null),
('TR','BDG','Badge','B','mm','pcs','71179090',18,false,null),
('TR','TOP','Trophy Topper','X','in','pcs','83062920',18,false,35),
('TR','BAS','Trophy Base','Y','in','pcs','44209090',18,false,35),
('AP','JRS','Jersey','J','size','pcs','6110',null,false,null),
('AP','TSH','T-Shirt','T','size','pcs','6109',null,false,null),
('AP','POL','Polo','P','size','pcs','6105',null,false,null),
('AP','SHT','Shorts','S','size','pcs','6104',null,false,null),
('AP','TRK','Track Pant','R','size','pcs','6103',null,false,null),
('AP','JKT','Jacket','W','size','pcs','6201',null,false,null),
('AP','CAP','Cap','C','size','pcs','6505',null,false,null),
('AP','SCK','Socks','O','size','pair','6115',null,false,null),
('AP','KIT','Kit Set','K','size','set','6112',null,false,null),
('IN','TRF','Artificial Turf','T','mm','sqft','57033090',18,false,22),
('IN','NET','Sports Net','N','ft','sqft','95069990',5,false,null),
('IN','FLR','Sports Flooring','F','mm','sqft','39181090',18,false,null),
('IN','GPT','Goal Post Set','G','none','set','95069990',5,false,null),
('IN','LGT','Flood Light','L','W','pcs','94054900',18,false,null),
('IN','FEN','Fencing','C','ft','sqft','73141990',18,false,null),
('IN','MAT','Sports Mat','M','mm','pcs','95069190',18,false,null),
('IN','MRK','Line Marking Paint','P','none','ltr','32089090',18,false,null),
('SV','ENG','Engraving','E','none','pcs','998898',18,true,75),
('SV','PRN','Logo Printing','P','none','pcs','998912',18,true,null),
('SV','NAM','Name & Number Printing','N','none','pcs','998912',18,true,null),
('SV','LOG','Logo Plate','L','none','pcs','998898',18,true,null),
('SV','ASM','Trophy Assembly','A','none','pcs','998898',18,true,null),
('SV','INS','Installation','I','none','sqft','995468',18,true,null);

insert into public.code_lists(kind,code,name,sort)
select 'material', c, n, row_number() over () from (values
('MT','Metal'),('BR','Brass'),('ST','Steel'),('WD','Wood'),('FB','Fibre'),('GL','Glass'),('CR','Crystal'),('AC','Acrylic'),('RS','Resin'),('MX','Mixed'),('DF','Dri-fit Polyester'),('PL','Polyester'),('CT','Cotton'),('CB','Cotton Blend'),('LY','Lycra'),('NY','Nylon'),('PE','Polyethylene'),('PP','Polypropylene'),('PU','Polyurethane'),('PV','PVC'),('RB','Rubber'),('GI','Galvanised Iron'),('AL','Aluminium'),('NA','Not applicable')) v(c,n);
insert into public.code_lists(kind,code,name,sort)
select 'sport', c, n, row_number() over () from (values
('GEN','Generic'),('MUL','Multi-sport'),('CRK','Cricket'),('FTB','Football'),('BDM','Badminton'),('BSK','Basketball'),('VLB','Volleyball'),('TTN','Table Tennis'),('TNS','Tennis'),('PKL','Pickleball'),('KBD','Kabaddi'),('HKY','Hockey'),('ATH','Athletics'),('CHS','Chess'),('CRM','Carrom'),('SWM','Swimming'),('SKT','Skating'),('BOX','Boxing'),('YGA','Yoga'),('ESP','Esports'),('GLF','Golf'),('COR','Corporate')) v(c,n);
insert into public.code_lists(kind,code,name,sort)
select 'finish', c, n, row_number() over () from (values
('GD','Gold'),('SV','Silver'),('BZ','Bronze'),('RG','Rose Gold'),('AN','Antique'),('CH','Chrome'),('CL','Clear'),('FR','Frosted'),('NT','Natural'),('BK','Black'),('WH','White'),('BL','Blue'),('NV','Navy'),('RD','Red'),('MR','Maroon'),('GN','Green'),('YL','Yellow'),('OR','Orange'),('GY','Grey'),('PK','Pink'),('PR','Purple'),('MC','Multi-colour'),('NA','Not applicable')) v(c,n);
insert into public.code_lists(kind,code,name,sort)
select 'apparel_size', c, n, row_number() over () from (values
('XSM','XS'),('SML','S'),('MED','M'),('LRG','L'),('XLG','XL'),('2XL','2XL'),('3XL','3XL'),('4XL','4XL'),('K22','Kids 22'),('K24','Kids 24'),('K26','Kids 26'),('K28','Kids 28'),('K30','Kids 30'),('K32','Kids 32'),('K34','Kids 34'),('FRE','Free Size')) v(c,n);

insert into public.app_settings(id,data) values (1, '{
 "bands":[{"from":0,"mult":2.5},{"from":1000,"mult":2},{"from":2001,"mult":1.5}],
 "basis":"pre_gst","edge_protection":false,
 "apparel_gst":{"threshold":2500,"low":5,"high":18},
 "catalogue_divisions":["TR"],"logo_url":null,"zoho_templates":{}
}'::jsonb);

-- SAMPLE DATA
insert into public.vendors(code,display_name,company,gst_treatment,gstin,source_of_supply,pan,state,city,pin,payment_terms,divisions,status,quality,notes,is_sample,email,phone,street1)
values ('V001','SAMPLE – Shree Trophy Works','Shree Trophy Works','business_registered_regular','33AABCS1429B1Z5','TN','AABCS1429B','Tamil Nadu','Chennai','600001','Net 30','{TR}','Active',4,'Sample vendor – clear from Settings',true,'sales@example.com','04412345678','12 Mint Street'),
       ('V002','SAMPLE – Kiran Sportswear','Kiran Sportswear','business_unregistered',null,'KA',null,'Karnataka','Bengaluru','560001','Advance','{AP}','Sample',3,'Sample vendor – clear from Settings',true,null,null,null);

with f as (
 insert into public.design_families(div,type,mat,sport,design_no,design_name) values
 ('TR','CUP','MT','CRK',1,'Champion'),('TR','DIA','CR','COR',1,'Aurora'),('AP','JRS','DF','FTB',1,'Velocity')
 returning id, type)
insert into public.products(code,prefix,family_id,div,type,mat,sport,size,finish,spec_code,friendly_name,status,unit_cost,preferred_vendor_id,location,stock,reorder_point,description,is_sample)
select v.code, v.prefix, f.id, v.div, v.type, v.mat, v.sport, v.size, v.finish, v.spec, v.fname, 'Active', v.cost,
  (select id from public.vendors where code=v.vend), v.loc, v.stock, 5, v.descr, true
from (values
 ('TC-1001','TC','TR','CUP','MT','CRK','012','GD','TR-CUP-MT-CRK-001-012-GD','Champion Cup · 12in · Gold',450,'V001','A1-03',12,'Metal cricket cup trophy with marble base. SAMPLE'),
 ('TC-1002','TC','TR','CUP','MT','CRK','016','GD','TR-CUP-MT-CRK-001-016-GD','Champion Cup · 16in · Gold',780,'V001','A1-04',6,'Metal cricket cup trophy, tall edition. SAMPLE'),
 ('TD-1001','TD','TR','DIA','CR','COR','008','CL','TR-DIA-CR-COR-001-008-CL','Aurora · 8in · Clear',1200,'V001','B2-01',4,'Crystal diamond award for corporate recognition. SAMPLE'),
 ('AJ-1001','AJ','AP','JRS','DF','FTB','LRG','BL','AP-JRS-DF-FTB-001-LRG-BL','Velocity · L · Blue',320,'V002','C1-02',20,'Dri-fit football jersey. SAMPLE')
) v(code,prefix,div,type,mat,sport,size,finish,spec,fname,cost,vend,loc,stock,descr)
join f on f.type=v.type;

update public.products set friendly_name='Champion Cup · 12in · Gold' where code='TC-1001';
update public.design_families set design_name='Champion Cup' where design_name='Champion';

insert into public.code_counters(prefix,next_no) values ('TC',1003),('TD',1002),('AJ',1002);

insert into public.vendor_codes(vendor_id,match_key,vendor_item_code,description,product_id,last_cost)
select (select id from public.vendors where code='V001'),'c:stw-cc12','STW-CC12','Cricket cup 12 inch gold',(select id from public.products where code='TC-1001'),450;
